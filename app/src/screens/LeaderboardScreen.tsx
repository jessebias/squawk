// Leaderboard — ranked by lifetime staking volume across all channels
// (reference: "Top Daredevils" board, restyled to the Squawk theme).
// Every row is a real on-chain wallet: bots and humans alike.
import React, { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";
import { colors, fonts, gradient, hairline, radius } from "../theme";
import { fetchLeaderboard, type LeaderboardEntry } from "../lib/squawk";
import { avatarOf } from "../lib/demoContent";
import { useWallet } from "../hooks/useWallet";
import { AppHeader } from "../components/AppHeader";

const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

export function LeaderboardScreen() {
  const wallet = useWallet();
  const [search, setSearch] = useState("");

  const board = useQuery({
    queryKey: ["leaderboard"],
    queryFn: fetchLeaderboard,
    refetchInterval: 60000,
  });

  const rows = useMemo(() => {
    const all = (board.data ?? []).map((e, i) => ({ ...e, rank: i + 1 }));
    if (!search) return all;
    const q = search.toLowerCase();
    return all.filter((e) => e.user.toBase58().toLowerCase().includes(q));
  }, [board.data, search]);

  const me = wallet.publicKey?.toBase58();

  const rankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <LinearGradient
          colors={[...gradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.rankBadge}
        >
          <Text style={styles.rankTextOn}>1</Text>
        </LinearGradient>
      );
    }
    if (rank <= 3) {
      return (
        <View style={[styles.rankBadge, { backgroundColor: colors.cardElevated }]}>
          <Text style={styles.rankText}>{rank}</Text>
        </View>
      );
    }
    return (
      <View style={styles.rankBadge}>
        <Text style={[styles.rankText, { color: colors.textMuted }]}>{rank}</Text>
      </View>
    );
  };

  const row = ({ item }: { item: LeaderboardEntry & { rank: number } }) => {
    const isMe = item.user.toBase58() === me;
    return (
      <View style={[styles.row, isMe && { borderColor: colors.accent, borderWidth: 0.75 }]}>
        <View style={styles.rowLeft}>
          {rankBadge(item.rank)}
          <View style={styles.avatar}>
            <Text style={{ fontSize: 15 }}>{avatarOf(item.user)}</Text>
          </View>
          <View>
            <Text style={styles.name}>
              {isMe ? "you" : short(item.user.toBase58())}
            </Text>
            <Text style={styles.sub}>
              {item.channels} channel{item.channels === 1 ? "" : "s"}
            </Text>
          </View>
        </View>
        <Text style={styles.points}>{item.points.toLocaleString()}</Text>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <AppHeader />

      <Text style={styles.title}>TOP SQUAWKERS</Text>
      <View style={styles.infoCard}>
        <Feather name="zap" size={14} color={colors.accent} />
        <Text style={styles.infoText}>
          Stake in live channels to earn points and climb the board.
        </Text>
      </View>

      <View style={styles.search}>
        <Feather name="search" size={15} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Find player"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <View style={styles.columns}>
        <Text style={styles.colText}>RANK · NAME</Text>
        <Text style={styles.colText}>POINTS</Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(e) => e.user.toBase58()}
        renderItem={row}
        contentContainerStyle={{ gap: 8, paddingBottom: 16 }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {board.isLoading
              ? "scanning devnet…"
              : board.error
              ? `error: ${String(board.error).slice(0, 160)}`
              : "no players yet"}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 8 },
  title: {
    fontFamily: fonts.wordmark,
    fontSize: 22,
    color: colors.text,
    textShadowColor: colors.accent,
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
    marginBottom: 10,
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 12,
  },
  infoText: { color: colors.textSecondary, fontSize: 12, flex: 1 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 12, paddingVertical: 10 },
  columns: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  colText: { color: colors.textMuted, fontSize: 10, letterSpacing: 1, fontWeight: "700" },
  row: {
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
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  rankBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  rankTextOn: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.cardElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { color: colors.text, fontSize: 13, fontWeight: "600" },
  sub: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  points: { color: colors.yesText, fontSize: 14, fontWeight: "800" },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: 48, fontSize: 12 },
});
