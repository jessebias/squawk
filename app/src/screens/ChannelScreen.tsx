// The live channel: round card + odds + PTT, all fed by ER websockets.
// Every stake here is a real Solana transaction on the Ephemeral Rollup.
//
// Private channels (visibility=1) run on the TEE Private ER: all reads go
// through a token-authenticated connection (session key for players, host
// key for the host). Round accounts are HOST-ONLY readable — players follow
// the round through the channel's board-mirror fields and the pools stay
// hidden until resolve (blind betting).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { colors, fonts, gradient, hairline, radius } from "../theme";
import { FrequencyDisplay } from "../components/FrequencyDisplay";
import { HandsetFrame } from "../components/HandsetFrame";
import { HostPanel } from "../components/HostPanel";
import { OddsCards } from "../components/OddsCards";
import { PTTButton } from "../components/PTTButton";
import { SettlementCard } from "../components/SettlementCard";
import { Skeleton } from "../components/Skeleton";
import { SpeakerGrille } from "../components/SpeakerGrille";
import { Ticker } from "../components/Ticker";
import {
  buildJoinTx,
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
import { baseConn, erConn, getTeeConnection } from "../lib/connections";
import { describeError } from "../lib/host";
import { getHostKeypair } from "../lib/hostKey";
import { haptic } from "../lib/haptics";
import { useWallet } from "../hooks/useWallet";

const JOIN_AMOUNT_USDC = 10;
const MIRROR_STATUS: RoundAccount["status"][] = [
  "pending",
  "staking",
  "locked",
  "resolvedYes",
  "resolvedNo",
  "voided",
];

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
  const [hostKey, setHostKey] = useState<Keypair | null>(null);
  const [privConn, setPrivConn] = useState<Connection | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [transmitting, setTransmitting] = useState(false);
  const claiming = useRef(false);
  const prevPools = useRef({ yes: 0, no: 0 });

  // hosting is device-bound: the local host burner owns channels created here
  useEffect(() => {
    getHostKeypair().then(setHostKey).catch(() => {});
  }, []);
  const isHost = !!channel && !!hostKey && channel.host.equals(hostKey.publicKey);
  const isPrivate = channel?.visibility === 1;

  // private channels: a token-authenticated TEE connection per identity —
  // host key when hosting, session key otherwise. All ER traffic for the
  // channel flows through it.
  useEffect(() => {
    if (!isPrivate) {
      setPrivConn(null);
      return;
    }
    const identity = isHost ? hostKey : wallet.sessionKey;
    if (!identity) return;
    let stale = false;
    getTeeConnection(identity)
      .then((c) => {
        if (!stale) setPrivConn(c);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [isPrivate, isHost, hostKey, wallet.sessionKey]);

  const erSel = isPrivate ? privConn : erConn;

  // channel: ER websocket for low-latency updates PLUS a 3s poll (ER first,
  // base fallback) — the ws alone can miss the moment the account is first
  // cloned into the ER at go_live, and status flips happen on base. On a
  // private channel the live board mirror is only readable through the
  // authed TEE conn; the base clone is the frozen pre-delegation snapshot.
  useEffect(() => {
    let stop = false;
    const conns = [erSel, baseConn].filter(Boolean) as Connection[];
    const poll = async () => {
      for (const conn of conns) {
        try {
          const raw = await (getProgram(conn).account as any).channel.fetch(channelPk);
          if (!stop) setChannel(decodeChannel(channelPk, raw));
          return;
        } catch {}
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    const unsub = erSel
      ? subscribeEr(channelPk, "Channel", (raw) => setChannel(decodeChannel(channelPk, raw)), erSel)
      : () => {};
    return () => {
      stop = true;
      clearInterval(interval);
      unsub();
    };
  }, [erSel]);

  // round: follow channel.activeRound on the ER. 1s polling is the workhorse
  // (RN's ER websocket delivery is unreliable); the ws sub is a bonus when it
  // does connect. On private channels only the HOST can read Round accounts —
  // players skip this and synthesize the round from the board mirror below.
  const activeRound = channel?.status === "live" ? channel.activeRound : null;
  const canReadRound = !isPrivate || isHost;
  useEffect(() => {
    if (activeRound === null || !channel || !canReadRound || !erSel) return;
    const pda = roundPda(channelPk, activeRound);
    let stop = false;
    const poll = async () => {
      try {
        const raw = await (getProgram(erSel).account as any).round.fetch(pda);
        if (!stop) handleRound(decodeRound(raw));
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 1000);
    const unsub = subscribeEr(pda, "Round", (raw) => handleRound(decodeRound(raw)), erSel);
    return () => {
      stop = true;
      clearInterval(interval);
      unsub();
    };
  }, [activeRound, canReadRound, erSel]);

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

  // private players: the round is synthesized from the channel board mirror
  // (question, timing, status; pools = the resolve-time reveal, 0 while live)
  const mirrorRound: RoundAccount | null = useMemo(() => {
    if (!channel || channel.status !== "live") return null;
    const status = MIRROR_STATUS[channel.activeRoundStatus] ?? "pending";
    if (status === "pending") return null;
    return {
      question: channel.activeQuestion,
      status,
      yesPool: channel.revealYes,
      noPool: channel.revealNo,
      opensAt: new BN(0),
      locksAt: channel.activeLocksAt,
      roundIndex: channel.activeRound,
    };
  }, [channel]);

  const effRound = canReadRound ? round : mirrorRound;
  const blindNow =
    isPrivate &&
    !isHost &&
    !!effRound &&
    (effRound.status === "staking" || effRound.status === "locked");

  // ticker for private players (no pool deltas to report while blind)
  useEffect(() => {
    if (canReadRound || !mirrorRound) return;
    if (mirrorRound.status === "staking")
      setTicker("blind round — stakes hidden until the call");
    else if (mirrorRound.status === "locked") setTicker("round locked — waiting for the call");
    else if (mirrorRound.status === "resolvedYes")
      setTicker(`resolved YES — pools revealed ${(mirrorRound.yesPool.toNumber() / 1e6).toFixed(2)} / ${(mirrorRound.noPool.toNumber() / 1e6).toFixed(2)}`);
    else if (mirrorRound.status === "resolvedNo")
      setTicker(`resolved NO — pools revealed ${(mirrorRound.yesPool.toNumber() / 1e6).toFixed(2)} / ${(mirrorRound.noPool.toNumber() / 1e6).toFixed(2)}`);
    else if (mirrorRound.status === "voided") setTicker("voided — stakes refunded");
  }, [canReadRound, mirrorRound?.status]);

  // member: 2s poll (ER first, base fallback pre-delegation) + ws bonus.
  // On a private channel the member account is readable only by its own
  // session key (+ host) — exactly the identity behind erSel.
  useEffect(() => {
    if (!wallet.publicKey) return;
    let stop = false;
    const pda = memberPda(channelPk, wallet.publicKey);
    const poll = async () => {
      const m = erSel ? await fetchMemberOnEr(channelPk, wallet.publicKey!, erSel) : null;
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
    const unsub = erSel
      ? subscribeEr(pda, "Member", (raw) => setMember(raw as MemberAccount), erSel)
      : () => {};
    return () => {
      stop = true;
      clearInterval(interval);
      unsub();
    };
  }, [wallet.publicKey?.toBase58(), erSel]);

  // auto-claim the moment our position's round resolves (free on the ER),
  // with a win/loss/void haptic per outcome
  useEffect(() => {
    if (!effRound || !member || !wallet.sessionKey || !wallet.publicKey) return;
    const resolved = ["resolvedYes", "resolvedNo", "voided"].includes(effRound.status);
    const hasPosition =
      member.position.amount.toNumber() > 0 &&
      member.position.roundIndex === effRound.roundIndex;
    if (resolved && hasPosition && !claiming.current) {
      claiming.current = true;
      const mySide = Object.keys(member.position.side)[0];
      if (effRound.status === "voided") haptic.warning();
      else if (
        (effRound.status === "resolvedYes" && mySide === "yes") ||
        (effRound.status === "resolvedNo" && mySide === "no")
      )
        haptic.success();
      else haptic.error();
      claimOnEr(
        wallet.sessionKey,
        wallet.publicKey,
        channelPk,
        effRound.roundIndex,
        erSel ?? erConn
      )
        .then(() => setErTxs((n) => n + 1))
        .catch(() => {})
        .finally(() => (claiming.current = false));
    }
  }, [effRound?.status, member?.position.amount.toNumber()]);

  const stake = useCallback(
    async (amount: number) => {
      if (!wallet.sessionKey || !wallet.publicKey || !channel || effRound?.status !== "staking")
        return;
      if (isPrivate && !privConn) return;
      try {
        await stakeOnEr(
          wallet.sessionKey,
          wallet.publicKey,
          channelPk,
          effRound.roundIndex,
          side,
          amount,
          erSel ?? erConn
        );
        setErTxs((n) => n + 1);
      } catch (e) {
        const msg = describeError(e);
        // 6013 RoundNotStaking / 6014 RoundLockPassed — racing the lock is
        // normal near the buzzer; don't show a scary error code for it
        setTicker(
          /6013|6014|RoundNotStaking|RoundLockPassed/.test(msg)
            ? "too late — round locked"
            : `stake failed: ${msg.slice(0, 60)}`
        );
      }
    },
    [
      wallet.sessionKey,
      wallet.publicKey,
      channel,
      effRound?.roundIndex,
      effRound?.status,
      side,
      erSel,
      isPrivate,
      privConn,
    ]
  );

  // join for channels reached by invite code / deep link (Discover joins on
  // card tap; unlisted private channels never appear there)
  const join = useCallback(async () => {
    if (!wallet.ready || !wallet.publicKey || !wallet.sessionKey || !channel) return;
    setJoinBusy(true);
    try {
      const tx = await buildJoinTx(
        wallet.publicKey,
        wallet.sessionKey.publicKey,
        channel,
        JOIN_AMOUNT_USDC
      );
      await wallet.signAndSend(tx);
      haptic.success();
      setTicker("joined — waiting for the host to go live");
    } catch (e) {
      haptic.error();
      setTicker(`join failed: ${describeError(e).slice(0, 80)}`);
    } finally {
      setJoinBusy(false);
    }
  }, [wallet.ready, wallet.publicKey, wallet.sessionKey?.publicKey.toBase58(), channel]);

  const shareInvite = useCallback(() => {
    Share.share({
      message:
        `Join my private Squawk channel 🔒\n` +
        `squawk://channel/${channelPk.toBase58()}\n` +
        `invite code: ${channelPk.toBase58()}`,
    }).catch(() => {});
  }, [channelPk.toBase58()]);

  const balance = member ? member.balance.toNumber() / 1e6 : null;
  const staked =
    member && member.position.amount.toNumber() > 0
      ? member.position.amount.toNumber() / 1e6
      : 0;
  const canStake =
    !!member &&
    effRound?.status === "staking" &&
    (balance ?? 0) > 0 &&
    channel?.status === "live" &&
    (!isPrivate || !!privConn);

  const pool =
    ((effRound?.yesPool.toNumber() ?? 0) + (effRound?.noPool.toNumber() ?? 0)) / 1e6;
  const showJoin = channel?.status === "open" && !member && !isHost && wallet.ready;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable onPress={() => nav.goBack()} hitSlop={12}>
            <Feather name="chevron-left" size={20} color={colors.textSecondary} />
          </Pressable>
          <View style={styles.titleRow}>
            {isPrivate && <Feather name="lock" size={12} color={colors.accent} />}
            <Text style={styles.title}>{channel?.title ?? "…"}</Text>
          </View>
        </View>
        {isPrivate && isHost && (
          <Pressable onPress={shareInvite} hitSlop={10}>
            <Feather name="share-2" size={16} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {!channel ? (
          <>
            <Skeleton height={170} style={{ borderRadius: 28 }} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Skeleton height={92} style={{ flex: 1 }} />
              <Skeleton height={92} style={{ flex: 1 }} />
            </View>
            <Skeleton height={36} />
          </>
        ) : channel.status === "closed" ? (
          <SettlementCard channelPk={channelPk} erTxs={erTxs} />
        ) : (
          <HandsetFrame live={channel.status === "live"} isPrivate={isPrivate}>
            <Text style={styles.statusReadout}>
              {channel.status === "live"
                ? `STATUS: LIVE · ${channel.userCount} CONNECTED`
                : `STATUS: OPEN · ${channel.userCount} JOINED`}
              {isPrivate ? " · ENCRYPTED" : ""}
            </Text>
            <FrequencyDisplay
              round={effRound}
              channel={channel}
              roundCount={channel.roundCount}
              transmitting={transmitting}
              blind={blindNow}
            />
            <SpeakerGrille
              active={effRound?.status === "staking"}
              transmitting={transmitting}
            />
            <OddsCards
              yesPool={(effRound?.yesPool.toNumber() ?? 0) / 1e6}
              noPool={(effRound?.noPool.toNumber() ?? 0) / 1e6}
              selected={side}
              onSelect={setSide}
              hidden={blindNow}
            />
            <View style={styles.poolRow}>
              <Text style={styles.poolText}>
                {blindNow ? "POOL ••• USDC" : `POOL ${pool.toFixed(2)} USDC`}
              </Text>
              <Text style={styles.poolText}>0 FEES ON CHANNEL</Text>
            </View>
            <Ticker message={ticker} />
            {isHost && hostKey && (
              <HostPanel
                channel={channel}
                round={round}
                hostKey={hostKey}
                onErTx={(n) => setErTxs((c) => c + n)}
              />
            )}
            <PTTButton
              disabled={!canStake}
              side={side}
              onStake={stake}
              onHoldChange={setTransmitting}
            />
            <Text style={styles.connReadout}>
              ● {channel.userCount} connected ·{" "}
              {transmitting ? "TRANSMITTING" : "no transmission"}
            </Text>
            {showJoin && (
              <Pressable onPress={join} disabled={joinBusy}>
                <LinearGradient
                  colors={[...gradient]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.joinBtn}
                >
                  <Text style={styles.joinText}>
                    {joinBusy ? "JOINING…" : `JOIN · ${JOIN_AMOUNT_USDC} USDC`}
                  </Text>
                </LinearGradient>
              </Pressable>
            )}
            {channel.status === "open" && !isHost && !showJoin && (
              <Text style={styles.waiting}>channel opens when the host goes live…</Text>
            )}
            {channel.status === "live" && isPrivate && !member && !isHost && (
              <Text style={styles.waiting}>
                🔒 private channel — stakes are hidden, members only
              </Text>
            )}
          </HandsetFrame>
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
  titleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  title: { color: colors.text, fontSize: 14, fontWeight: "600" },
  content: { paddingHorizontal: 14, gap: 12, paddingBottom: 16 },
  statusReadout: {
    fontFamily: fonts.lcdMed,
    fontSize: 10,
    color: colors.textSecondary,
    letterSpacing: 1.5,
    textAlign: "center",
  },
  connReadout: {
    fontFamily: fonts.lcdMed,
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 1,
    textAlign: "center",
  },
  poolRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  poolText: {
    fontFamily: fonts.lcdMed,
    color: colors.textMuted,
    fontSize: 9,
    letterSpacing: 1,
  },
  waiting: { color: colors.textSecondary, textAlign: "center", fontSize: 12 },
  joinBtn: {
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: "center",
  },
  joinText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", letterSpacing: 1 },
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
