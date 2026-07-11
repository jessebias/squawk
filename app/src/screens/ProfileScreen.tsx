// Profile/Settle: wallet identity, balances, and the "Collect" moment
// (withdraw on base layer after channel close) — docs/plan.md §7.1.
import React from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useQuery } from "@tanstack/react-query";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { colors, radius } from "../theme";
import { useWallet } from "../hooks/useWallet";
import { baseConn } from "../lib/connections";
import { buildWithdrawTx, fetchMemberships } from "../lib/squawk";

export function ProfileScreen() {
  const wallet = useWallet();

  const sol = useQuery({
    queryKey: ["sol", wallet.publicKey?.toBase58()],
    enabled: !!wallet.publicKey,
    refetchInterval: 8000,
    queryFn: async () => (await baseConn.getBalance(wallet.publicKey!)) / LAMPORTS_PER_SOL,
  });

  const memberships = useQuery({
    queryKey: ["memberships", wallet.publicKey?.toBase58()],
    enabled: !!wallet.publicKey,
    refetchInterval: 8000,
    queryFn: () => fetchMemberships(wallet.publicKey!),
  });

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    Alert.alert("Copied", `${label} copied — fund it with scripts/fund-wallet.ts`);
  };

  const collect = async (m: NonNullable<typeof memberships.data>[number]) => {
    try {
      const tx = await buildWithdrawTx(wallet.publicKey!, m.channel);
      await wallet.signAndSend(tx);
      Alert.alert("Collected", "USDC is back in your wallet.");
      memberships.refetch();
    } catch (e) {
      Alert.alert("Collect failed", String(e).slice(0, 160));
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text style={styles.heading}>Profile</Text>

      <View style={styles.card}>
        <Text style={styles.label}>WALLET (tap to copy)</Text>
        <Pressable
          onPress={() => wallet.publicKey && copy("Wallet", wallet.publicKey.toBase58())}
        >
          <Text style={styles.mono}>{wallet.publicKey?.toBase58() ?? "…"}</Text>
        </Pressable>
        <Text style={styles.meta}>{sol.data?.toFixed(3) ?? "—"} devnet SOL</Text>
        <Text style={styles.label}>SESSION KEY</Text>
        <Text style={styles.mono}>
          {wallet.sessionKey?.publicKey.toBase58() ?? "…"}
        </Text>
      </View>

      <Text style={styles.heading2}>Channels</Text>
      {(memberships.data ?? []).map((m) => (
        <View key={m.channel.pubkey.toBase58()} style={styles.card}>
          <Text style={styles.channelTitle}>{m.channel.title}</Text>
          <Text style={styles.meta}>
            {m.channel.status.toUpperCase()} · balance{" "}
            {(m.member.balance.toNumber() / 1e6).toFixed(2)} USDC (deposited{" "}
            {(m.member.deposited.toNumber() / 1e6).toFixed(2)})
          </Text>
          {(m.channel.status === "closed" || m.channel.status === "open") &&
            m.member.balance.toNumber() > 0 && (
              <Pressable style={styles.collect} onPress={() => collect(m)}>
                <Text style={styles.collectText}>COLLECT</Text>
              </Pressable>
            )}
        </View>
      ))}
      {memberships.data?.length === 0 && (
        <Text style={styles.meta}>no channels yet — join one from Discover</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  heading: { color: colors.text, fontSize: 24, fontWeight: "800" },
  heading2: { color: colors.text, fontSize: 17, fontWeight: "700", marginTop: 4 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
  },
  label: { color: colors.textMuted, fontSize: 10, letterSpacing: 1, marginTop: 4 },
  mono: { color: colors.textSecondary, fontSize: 12 },
  meta: { color: colors.textSecondary, fontSize: 13 },
  channelTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  collect: {
    backgroundColor: colors.yes,
    borderRadius: radius.pill,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 6,
  },
  collectText: { color: "#FFFFFF", fontWeight: "800", letterSpacing: 1 },
});
