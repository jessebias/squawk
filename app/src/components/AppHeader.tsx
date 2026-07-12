// Shared app header (ALOT reference): gradient logo tile + wordmark, dual
// balance pill "available / total" with gradient + chip, bell.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import { colors, fonts, gradient, hairline, radius } from "../theme";
import { useWallet } from "../hooks/useWallet";
import { fetchMemberships, fetchUsdcBalance } from "../lib/squawk";

export function useBalances() {
  const wallet = useWallet();
  const usdc = useQuery({
    queryKey: ["usdc", wallet.publicKey?.toBase58()],
    enabled: !!wallet.publicKey,
    refetchInterval: 8000,
    queryFn: () => fetchUsdcBalance(wallet.publicKey!),
  });
  const memberships = useQuery({
    queryKey: ["memberships", wallet.publicKey?.toBase58()],
    enabled: !!wallet.publicKey,
    refetchInterval: 8000,
    queryFn: () => fetchMemberships(wallet.publicKey!),
  });
  const inChannels =
    memberships.data?.reduce((s, m) => s + m.member.balance.toNumber() / 1e6, 0) ?? 0;
  return {
    wallet,
    available: usdc.data,
    inChannels,
    total: usdc.data === undefined ? undefined : usdc.data + inChannels,
    memberships,
    refetchAll: () => {
      usdc.refetch();
      memberships.refetch();
    },
  };
}

export function AppHeader() {
  const { available, total } = useBalances();
  const fmt = (v: number | undefined) => (v === undefined ? "—" : v.toFixed(2));
  return (
    <View style={styles.header}>
      {/* hard orange offset shadow via a stacked orange copy (matches the
          splash) — crisper than textShadow on Android */}
      <View>
        <Text style={[styles.wordmark, styles.wordmarkShadow]}>SQUAWK</Text>
        <Text style={styles.wordmark}>SQUAWK</Text>
      </View>
      <View style={styles.headerRight}>
        <View style={styles.balancePill}>
          <View style={styles.dollar}>
            <Text style={styles.dollarText}>$</Text>
          </View>
          <Text style={styles.balanceText}>
            {fmt(available)}
            <Text style={styles.balanceTotal}> / {fmt(total)}</Text>
          </Text>
          <LinearGradient
            colors={[...gradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.plusChip}
          >
            <Feather name="plus" size={11} color="#FFFFFF" />
          </LinearGradient>
        </View>
        <Feather name="bell" size={17} color={colors.textSecondary} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  wordmark: {
    fontFamily: fonts.wordmark,
    fontSize: 18,
    color: colors.text,
  },
  wordmarkShadow: {
    position: "absolute",
    left: 2,
    top: 2, // hard offset down-right (scaled to the 18px header size)
    color: colors.accent, // #FF6B2C
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  balancePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.lcd,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingLeft: 10,
    paddingRight: 4,
  },
  dollar: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.yes,
    alignItems: "center",
    justifyContent: "center",
  },
  dollarText: { color: "#E1F5EE", fontSize: 9, fontWeight: "700" },
  balanceText: { fontFamily: fonts.lcdMed, color: colors.lcdText, fontSize: 11 },
  balanceTotal: { color: colors.lcdText, opacity: 0.5 },
  plusChip: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
