// The live channel: round card + odds + PTT, all fed by ER websockets.
// Every stake here is a real Solana transaction on the Ephemeral Rollup.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { PublicKey } from "@solana/web3.js";
import { colors, hairline } from "../theme";
import { LiveDot } from "../components/LiveDot";
import { OddsCards } from "../components/OddsCards";
import { PTTButton } from "../components/PTTButton";
import { RoundCard } from "../components/RoundCard";
import { Ticker } from "../components/Ticker";
import {
  claimOnEr,
  decodeChannel,
  decodeRound,
  fetchMemberOnEr,
  memberPda,
  roundPda,
  stakeOnEr,
  subscribeEr,
  type ChannelAccount,
  type MemberAccount,
  type RoundAccount,
} from "../lib/squawk";
import { getProgram } from "../lib/program";
import { baseConn, erConn } from "../lib/connections";
import { useWallet } from "../hooks/useWallet";

export function ChannelScreen() {
  const route = useRoute();
  const nav = useNavigation();
  const channelPk = new PublicKey((route.params as { channelPk: string }).channelPk);
  const wallet = useWallet();

  const [channel, setChannel] = useState<ChannelAccount | null>(null);
  const [round, setRound] = useState<RoundAccount | null>(null);
  const [member, setMember] = useState<MemberAccount | null>(null);
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [ticker, setTicker] = useState("waiting for the room…");
  const [erTxs, setErTxs] = useState(0);
  const claiming = useRef(false);
  const prevPools = useRef({ yes: 0, no: 0 });

  // channel: ER websocket for low-latency updates PLUS a 3s poll (ER first,
  // base fallback) — the ws alone can miss the moment the account is first
  // cloned into the ER at go_live, and status flips happen on base.
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      for (const conn of [erConn, baseConn]) {
        try {
          const raw = await (getProgram(conn).account as any).channel.fetch(channelPk);
          if (!stop) setChannel(decodeChannel(channelPk, raw));
          return;
        } catch {}
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    const unsub = subscribeEr(channelPk, "Channel", (raw) =>
      setChannel(decodeChannel(channelPk, raw))
    );
    return () => {
      stop = true;
      clearInterval(interval);
      unsub();
    };
  }, []);

  // round: follow channel.activeRound on the ER. 1s polling is the workhorse
  // (RN's ER websocket delivery is unreliable); the ws sub is a bonus when it
  // does connect, giving sub-second odds.
  const activeRound = channel?.status === "live" ? channel.activeRound : null;
  useEffect(() => {
    if (activeRound === null || !channel) return;
    const pda = roundPda(channelPk, activeRound);
    let stop = false;
    const poll = async () => {
      try {
        const raw = await (getProgram(erConn).account as any).round.fetch(pda);
        if (!stop) handleRound(decodeRound(raw));
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 1000);
    const unsub = subscribeEr(pda, "Round", (raw) => handleRound(decodeRound(raw)));
    return () => {
      stop = true;
      clearInterval(interval);
      unsub();
    };
  }, [activeRound]);

  const handleRound = (r: RoundAccount) => {
    setRound(r);
    const yes = r.yesPool.toNumber() / 1e6;
    const no = r.noPool.toNumber() / 1e6;
    const dYes = yes - prevPools.current.yes;
    const dNo = no - prevPools.current.no;
    if (dYes > 0.001) setTicker(`+${dYes.toFixed(2)} on YES`);
    else if (dNo > 0.001) setTicker(`+${dNo.toFixed(2)} on NO`);
    else if (r.status === "locked") setTicker("round locked — waiting for the call");
    else if (r.status === "resolvedYes") setTicker("resolved YES");
    else if (r.status === "resolvedNo") setTicker("resolved NO");
    else if (r.status === "voided") setTicker("voided — stakes refunded");
    prevPools.current = { yes, no };
  };

  // member: 2s poll (ER first, base fallback pre-delegation) + ws bonus
  useEffect(() => {
    if (!wallet.publicKey) return;
    let stop = false;
    const pda = memberPda(channelPk, wallet.publicKey);
    const poll = async () => {
      const m = await fetchMemberOnEr(channelPk, wallet.publicKey!);
      if (!m) {
        try {
          const raw = await (getProgram(baseConn).account as any).member.fetch(pda);
          if (!stop) setMember(raw as MemberAccount);
        } catch {}
        return;
      }
      if (!stop) setMember(m);
    };
    poll();
    const interval = setInterval(poll, 2000);
    const unsub = subscribeEr(pda, "Member", (raw) => setMember(raw as MemberAccount));
    return () => {
      stop = true;
      clearInterval(interval);
      unsub();
    };
  }, [wallet.publicKey?.toBase58()]);

  // auto-claim the moment our position's round resolves (free on the ER)
  useEffect(() => {
    if (!round || !member || !wallet.sessionKey || !wallet.publicKey) return;
    const resolved = ["resolvedYes", "resolvedNo", "voided"].includes(round.status);
    const hasPosition =
      member.position.amount.toNumber() > 0 &&
      member.position.roundIndex === round.roundIndex;
    if (resolved && hasPosition && !claiming.current) {
      claiming.current = true;
      claimOnEr(wallet.sessionKey, wallet.publicKey, channelPk, round.roundIndex)
        .then(() => setErTxs((n) => n + 1))
        .catch(() => {})
        .finally(() => (claiming.current = false));
    }
  }, [round?.status, member?.position.amount.toNumber()]);

  const stake = useCallback(
    async (amount: number) => {
      if (!wallet.sessionKey || !wallet.publicKey || !channel || round?.status !== "staking")
        return;
      try {
        await stakeOnEr(
          wallet.sessionKey,
          wallet.publicKey,
          channelPk,
          round.roundIndex,
          side,
          amount
        );
        setErTxs((n) => n + 1);
      } catch (e) {
        setTicker(`stake failed: ${String(e).slice(0, 60)}`);
      }
    },
    [wallet.sessionKey, wallet.publicKey, channel, round?.roundIndex, round?.status, side]
  );

  const balance = member ? member.balance.toNumber() / 1e6 : null;
  const staked =
    member && member.position.amount.toNumber() > 0
      ? member.position.amount.toNumber() / 1e6
      : 0;
  const canStake =
    !!member && round?.status === "staking" && (balance ?? 0) > 0 && channel?.status === "live";

  const pool = ((round?.yesPool.toNumber() ?? 0) + (round?.noPool.toNumber() ?? 0)) / 1e6;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable onPress={() => nav.goBack()} hitSlop={12}>
            <Feather name="chevron-left" size={20} color={colors.textSecondary} />
          </Pressable>
          <View>
            <Text style={styles.title}>{channel?.title ?? "…"}</Text>
            <Text style={styles.subtitle}>
              CH {channel ? channel.channelId.toString().slice(-4) : "…"}
              {channel && channel.status === "live"
                ? ` · round ${channel.activeRound + 1}`
                : ""}
            </Text>
          </View>
        </View>
        {channel?.status === "live" && (
          <View style={styles.liveWrap}>
            <LiveDot />
            <Text style={styles.liveText}>
              LIVE · <Text style={{ color: colors.textSecondary }}>{channel.userCount}</Text>
            </Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <RoundCard round={round} roundCount={channel?.roundCount ?? 0} />
        <OddsCards
          yesPool={(round?.yesPool.toNumber() ?? 0) / 1e6}
          noPool={(round?.noPool.toNumber() ?? 0) / 1e6}
          selected={side}
          onSelect={setSide}
        />
        <View style={styles.poolRow}>
          <Text style={styles.poolText}>Pool {pool.toFixed(2)} USDC</Text>
          <Text style={styles.poolText}>0 fees on channel</Text>
        </View>
        <Ticker message={ticker} />
        <PTTButton disabled={!canStake} side={side} onStake={stake} />
        {channel?.status === "open" && (
          <Text style={styles.waiting}>channel opens when the host goes live…</Text>
        )}
        {channel?.status === "closed" && (
          <Text style={styles.waiting}>channel settled — collect from Profile</Text>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <Feather name="credit-card" size={14} color={colors.textMuted} />
          <Text style={styles.footerBalance}>
            {balance === null ? "—" : balance.toFixed(2)} USDC
            {staked > 0 ? ` · staked ${staked.toFixed(2)}` : ""}
          </Text>
        </View>
        <Text style={styles.footerText}>{erTxs} ER txs · $0.00 fees</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: colors.text, fontSize: 14, fontWeight: "600" },
  subtitle: { color: colors.textMuted, fontSize: 11 },
  liveWrap: { flexDirection: "row", alignItems: "center", gap: 5 },
  liveText: { color: colors.live, fontSize: 11, letterSpacing: 1, fontWeight: "600" },
  content: { paddingHorizontal: 16, gap: 12, paddingBottom: 16 },
  poolRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  poolText: { color: colors.textMuted, fontSize: 11 },
  waiting: { color: colors.textSecondary, textAlign: "center", fontSize: 12 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 4,
  },
  footerLeft: { flexDirection: "row", alignItems: "center", gap: 5 },
  footerBalance: { color: colors.text, fontSize: 11 },
  footerText: { color: colors.textMuted, fontSize: 11 },
});
