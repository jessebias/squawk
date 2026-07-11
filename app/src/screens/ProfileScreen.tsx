// Profile — ALOT-style layout: Analytics sparkline, Balance + Coins cards,
// collect-all winnings strip, action tiles, recent activity.
import React, { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Svg, {
  Defs,
  LinearGradient as SvgGradient,
  Path,
  Stop,
} from "react-native-svg";
import { useQuery } from "@tanstack/react-query";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { colors, gradient, hairline, radius } from "../theme";
import { baseConn } from "../lib/connections";
import { buildWithdrawTx } from "../lib/squawk";
import { AppHeader, useBalances } from "../components/AppHeader";

const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

const emojiOf = (title: string): string => {
  const m = title.match(/\p{Extended_Pictographic}/u);
  return m ? m[0] : "🎙️";
};
const plainTitle = (title: string): string =>
  title.replace(/\p{Extended_Pictographic}/gu, "").trim();

function Sparkline() {
  return (
    <Svg width="100%" height="56" viewBox="0 0 320 56" preserveAspectRatio="none">
      <Defs>
        <SvgGradient id="area" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.yes} stopOpacity="0.35" />
          <Stop offset="1" stopColor={colors.yes} stopOpacity="0" />
        </SvgGradient>
      </Defs>
      <Path
        d="M0,46 C40,42 64,48 96,40 C136,30 160,38 196,26 C238,12 272,20 320,6 L320,56 L0,56 Z"
        fill="url(#area)"
      />
      <Path
        d="M0,46 C40,42 64,48 96,40 C136,30 160,38 196,26 C238,12 272,20 320,6"
        stroke={colors.yes}
        strokeWidth="1.5"
        fill="none"
      />
    </Svg>
  );
}

export function ProfileScreen() {
  const { wallet, available, total, memberships, refetchAll } = useBalances();
  const [collecting, setCollecting] = useState(false);

  const sol = useQuery({
    queryKey: ["sol", wallet.publicKey?.toBase58()],
    enabled: !!wallet.publicKey,
    refetchInterval: 8000,
    queryFn: async () => (await baseConn.getBalance(wallet.publicKey!)) / LAMPORTS_PER_SOL,
  });

  const collectible = (memberships.data ?? []).filter(
    (m) =>
      (m.channel.status === "closed" || m.channel.status === "open") &&
      m.member.balance.toNumber() > 0
  );
  const winnings = collectible.reduce((s, m) => s + m.member.balance.toNumber() / 1e6, 0);

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    Alert.alert("Copied", `${label} copied — fund it with scripts/fund-wallet.ts`);
  };

  const collectAll = async () => {
    if (!wallet.publicKey || collectible.length === 0 || collecting) return;
    setCollecting(true);
    let collected = 0;
    try {
      for (const m of collectible) {
        const tx = await buildWithdrawTx(wallet.publicKey, m.channel);
        await wallet.signAndSend(tx);
        collected += m.member.balance.toNumber() / 1e6;
      }
      Alert.alert("Collected", `${collected.toFixed(2)} USDC is back in your wallet.`);
    } catch (e) {
      Alert.alert(
        "Collect stopped",
        `Collected ${collected.toFixed(2)} so far.\n${String(e).slice(0, 120)}`
      );
    } finally {
      setCollecting(false);
      refetchAll();
    }
  };

  const tile = (
    icon: keyof typeof Feather.glyphMap,
    label: string,
    onPress: () => void
  ) => (
    <Pressable key={label} style={styles.tile} onPress={onPress}>
      <View style={styles.tileIcon}>
        <Feather name={icon} size={17} color={colors.text} />
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );

  const activityRow = (m: NonNullable<typeof memberships.data>[number]) => {
    const bal = m.member.balance.toNumber() / 1e6;
    const status = m.channel.status;
    const isCollectible = collectible.includes(m);
    const right = isCollectible
      ? { text: `+${bal.toFixed(2)}`, color: colors.yesText }
      : status === "live"
      ? { text: bal.toFixed(2), color: colors.text }
      : { text: "settled", color: colors.textMuted };
    const sub = isCollectible
      ? "ready to collect"
      : status === "live"
      ? "in play"
      : status === "open"
      ? "waiting for host"
      : "settled";
    return (
      <View key={m.channel.pubkey.toBase58()} style={styles.activityRow}>
        <View style={styles.activityLeft}>
          <View style={styles.avatar}>
            <Text style={{ fontSize: 15 }}>{emojiOf(m.channel.title)}</Text>
          </View>
          <View>
            <Text style={styles.activityTitle} numberOfLines={1}>
              {plainTitle(m.channel.title)}
            </Text>
            <Text style={styles.activitySub}>{sub}</Text>
          </View>
        </View>
        <Text style={[styles.activityAmount, { color: right.color }]}>{right.text}</Text>
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }}
    >
      <AppHeader />

      <View style={styles.analytics}>
        <View style={styles.analyticsTop}>
          <Text style={styles.cardTitle}>Analytics</Text>
          <Feather name="chevron-right" size={16} color={colors.textMuted} />
        </View>
        <Text style={styles.analyticsAmount}>+{winnings.toFixed(2)} USDC</Text>
        <View style={styles.sparkWrap}>
          <Sparkline />
        </View>
      </View>

      <View style={styles.midRow}>
        <View style={[styles.midCard, { flex: 1.5 }]}>
          <Text style={styles.cardTitle}>Balance</Text>
          <Text style={styles.subLabel}>Available</Text>
          <Text style={styles.bigNumber}>
            {available === undefined ? "—" : available.toFixed(2)}
            <Text style={styles.unit}>$</Text>
          </Text>
          <Text style={styles.subLabel}>Total</Text>
          <Text style={styles.midNumber}>
            {total === undefined ? "—" : total.toFixed(2)}
            <Text style={styles.unit}>$</Text>
          </Text>
          <View style={styles.usdcBadge}>
            <Text style={styles.usdcBadgeText}>$</Text>
          </View>
        </View>
        <View style={[styles.midCard, { flex: 1 }]}>
          <View style={styles.analyticsTop}>
            <Text style={styles.cardTitle}>Gas</Text>
            <Feather name="chevron-right" size={14} color={colors.textMuted} />
          </View>
          <Text style={[styles.bigNumber, { marginTop: 14 }]}>
            {sol.data === undefined ? "—" : sol.data.toFixed(2)}
          </Text>
          <Text style={styles.subLabel}>devnet SOL</Text>
          <LinearGradient
            colors={[...gradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.solBadge}
          >
            <Text style={styles.usdcBadgeText}>◎</Text>
          </LinearGradient>
        </View>
      </View>

      <View style={styles.collectStrip}>
        <View style={{ flex: 1 }}>
          <Text style={styles.collectAmount}>{winnings.toFixed(2)} USDC</Text>
          <Text style={styles.collectSub}>Your available winnings for now</Text>
        </View>
        <Pressable onPress={collectAll} disabled={winnings === 0 || collecting}>
          <LinearGradient
            colors={
              winnings === 0
                ? [colors.cardElevated, colors.cardElevated]
                : [...gradient]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.collectBtn}
          >
            <Text
              style={[
                styles.collectBtnText,
                winnings === 0 && { color: colors.textMuted },
              ]}
            >
              {collecting ? "…" : "Collect"}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>

      <View style={styles.tiles}>
        {tile("download", "Fund", () =>
          wallet.publicKey && copy("Wallet address", wallet.publicKey.toBase58())
        )}
        {tile("key", "Session", () =>
          wallet.sessionKey && copy("Session key", wallet.sessionKey.publicKey.toBase58())
        )}
        {tile("copy", "Address", () =>
          wallet.publicKey && copy("Wallet address", wallet.publicKey.toBase58())
        )}
      </View>

      <View style={styles.idCard}>
        <View style={styles.idRow}>
          <Text style={styles.idLabel}>WALLET</Text>
          <Text style={styles.idValue}>
            {wallet.publicKey ? short(wallet.publicKey.toBase58()) : "…"}
          </Text>
        </View>
        <View style={styles.idRow}>
          <Text style={styles.idLabel}>SESSION KEY</Text>
          <Text style={styles.idValue}>
            {wallet.sessionKey ? short(wallet.sessionKey.publicKey.toBase58()) : "…"}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Recent activity</Text>
      {(memberships.data ?? []).map(activityRow)}
      {memberships.data?.length === 0 && (
        <Text style={styles.emptyText}>no channels yet — join one from Discover</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  analytics: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: hairline,
    borderColor: colors.border,
    paddingTop: 16,
    paddingHorizontal: 16,
    overflow: "hidden",
  },
  analyticsTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  analyticsAmount: { color: colors.yesText, fontSize: 20, fontWeight: "800", marginTop: 4 },
  sparkWrap: { marginHorizontal: -16, marginTop: 6 },
  midRow: { flexDirection: "row", gap: 12 },
  midCard: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: hairline,
    borderColor: colors.border,
    padding: 16,
    overflow: "hidden",
  },
  subLabel: { color: colors.textMuted, fontSize: 11, marginTop: 10 },
  bigNumber: { color: colors.text, fontSize: 24, fontWeight: "800", marginTop: 2 },
  midNumber: { color: colors.textSecondary, fontSize: 17, fontWeight: "700", marginTop: 2 },
  unit: { fontSize: 13, color: colors.textMuted, fontWeight: "600" },
  usdcBadge: {
    position: "absolute",
    right: -8,
    bottom: -8,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.yes,
    alignItems: "center",
    justifyContent: "center",
  },
  solBadge: {
    position: "absolute",
    right: -8,
    bottom: -8,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  usdcBadgeText: { color: "#FFFFFF", fontSize: 20, fontWeight: "800" },
  collectStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: hairline,
    borderColor: colors.border,
    padding: 14,
  },
  collectAmount: { color: colors.text, fontSize: 17, fontWeight: "800" },
  collectSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  collectBtn: {
    borderRadius: radius.sm,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  collectBtnText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  tiles: { flexDirection: "row", gap: 10 },
  tile: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.lg,
    alignItems: "center",
    paddingVertical: 12,
    gap: 6,
  },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.cardElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  tileLabel: { color: colors.textSecondary, fontSize: 11 },
  idCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: hairline,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  idRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 11 },
  idLabel: { color: colors.textMuted, fontSize: 10, letterSpacing: 1 },
  idValue: { color: colors.textSecondary, fontSize: 12 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "700", marginTop: 4 },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  activityLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.cardElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  activityTitle: { color: colors.text, fontSize: 13, fontWeight: "600" },
  activitySub: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  activityAmount: { fontSize: 13, fontWeight: "800" },
  emptyText: { color: colors.textMuted, fontSize: 12 },
});
