// Discover — premium pass (ALOT reference): near-black canvas, gradient
// accents, icon-tile categories, avatar rows with bold pool numbers.
import React, { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { colors, gradient, hairline, radius } from "../theme";
import { buildJoinTx, fetchChannels, type ChannelAccount } from "../lib/squawk";
import { useWallet } from "../hooks/useWallet";
import { LiveDot } from "../components/LiveDot";
import { AppHeader } from "../components/AppHeader";
import type { RootStackParamList } from "../navigators/AppNavigator";

const JOIN_AMOUNT_USDC = 10;
const CATEGORIES: { label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { label: "All", icon: "layers" },
  { label: "Sport", icon: "target" },
  { label: "Streams", icon: "tv" },
  { label: "Crypto", icon: "trending-up" },
  { label: "IRL", icon: "map-pin" },
];

const emojiOf = (title: string): string => {
  const m = title.match(/\p{Extended_Pictographic}/u);
  return m ? m[0] : "🎙️";
};
const plainTitle = (title: string): string =>
  title.replace(/\p{Extended_Pictographic}/gu, "").trim();

export function DiscoverScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const wallet = useWallet();
  const [joining, setJoining] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(0);

  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: fetchChannels,
    refetchInterval: 4000,
  });

  const filtered = useMemo(
    () =>
      (channels.data ?? []).filter((c) =>
        c.title.toLowerCase().includes(search.toLowerCase())
      ),
    [channels.data, search]
  );
  const trending = filtered.slice(0, 6);
  const rest = filtered.slice(6);

  const open = async (channel: ChannelAccount) => {
    if (channel.status === "live") {
      nav.navigate("Channel", { channelPk: channel.pubkey.toBase58() });
      return;
    }
    if (!wallet.ready || !wallet.publicKey || !wallet.sessionKey) return;
    setJoining(channel.pubkey.toBase58());
    try {
      const tx = await buildJoinTx(
        wallet.publicKey,
        wallet.sessionKey.publicKey,
        channel,
        JOIN_AMOUNT_USDC
      );
      await wallet.signAndSend(tx);
      nav.navigate("Channel", { channelPk: channel.pubkey.toBase58() });
    } catch (e) {
      Alert.alert(
        "Join failed",
        `${String(e).slice(0, 140)}\n\nFund this wallet from Profile (needs devnet SOL + mock USDC).`
      );
    } finally {
      setJoining(null);
    }
  };

  const trendingCard = ({ item: c }: { item: ChannelAccount }) => {
    const live = c.status === "live";
    const busy = joining === c.pubkey.toBase58();
    return (
      <Pressable
        onPress={() => open(c)}
        disabled={joining !== null}
        style={[styles.trendCard, live && { borderColor: colors.accent, borderWidth: 0.75 }]}
      >
        <View style={styles.cover}>
          <Text style={styles.coverEmoji}>{emojiOf(c.title)}</Text>
          {live && (
            <View style={styles.liveBadge}>
              <LiveDot size={5} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
        </View>
        <Text style={styles.trendTitle} numberOfLines={1}>
          {plainTitle(c.title)}
        </Text>
        <Text style={styles.trendMeta}>
          <Text style={styles.trendPool}>
            {(c.totalPool.toNumber() / 1e6).toFixed(1)} USDC
          </Text>{" "}
          Pool{!live ? (busy ? " · joining…" : " · join 10") : ""}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <AppHeader />

      <View style={styles.search}>
        <Feather name="search" size={15} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search channels"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {trending.length > 0 && (
        <View style={styles.trendPanel}>
          <View style={styles.sectionRow}>
            <Feather name="zap" size={15} color={colors.accent} />
            <Text style={styles.sectionTitle}>Trending</Text>
          </View>
          <FlatList
            horizontal
            data={trending}
            keyExtractor={(c) => c.pubkey.toBase58()}
            renderItem={trendingCard}
            showsHorizontalScrollIndicator={false}
            snapToInterval={158}
            decelerationRate="fast"
            contentContainerStyle={{ gap: 10, paddingHorizontal: 12 }}
          />
          <LinearGradient
            colors={[...gradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.glowLine}
          />
        </View>
      )}

      <View style={styles.tiles}>
        {CATEGORIES.map((c, i) => {
          const on = category === i;
          return (
            <Pressable key={c.label} onPress={() => setCategory(i)} style={styles.tileWrap}>
              {on ? (
                <LinearGradient
                  colors={[...gradient]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.tile}
                >
                  <Feather name={c.icon} size={18} color="#FFFFFF" />
                </LinearGradient>
              ) : (
                <View style={[styles.tile, styles.tileOff]}>
                  <Feather name={c.icon} size={18} color={colors.textSecondary} />
                </View>
              )}
              <Text style={[styles.tileLabel, on && { color: colors.text }]}>
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={rest}
        keyExtractor={(c) => c.pubkey.toBase58()}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => open(item)}
            disabled={joining !== null}
          >
            <View style={styles.rowLeft}>
              <View style={styles.avatar}>
                <Text style={{ fontSize: 16 }}>{emojiOf(item.title)}</Text>
              </View>
              <View>
                <Text style={styles.rowTitle}>{plainTitle(item.title)}</Text>
                <Text style={styles.rowMeta}>
                  {item.userCount} in{item.status === "open" ? " · tap to join" : " · live"}
                </Text>
              </View>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.rowPool}>
                {(item.totalPool.toNumber() / 1e6).toFixed(1)}
              </Text>
              <Feather name="chevron-right" size={16} color={colors.textMuted} />
            </View>
          </Pressable>
        )}
        contentContainerStyle={{ gap: 8, paddingBottom: 16 }}
        ListEmptyComponent={
          trending.length === 0 ? (
            <Text style={styles.empty}>
              {channels.isLoading
                ? "scanning devnet…"
                : channels.error
                ? `error: ${String(channels.error).slice(0, 160)}`
                : "no channels yet — start one from the host laptop"}
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 8 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 12, paddingVertical: 10 },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
    paddingHorizontal: 12,
  },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  trendPanel: {
    backgroundColor: colors.card,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.xl,
    paddingTop: 14,
    paddingBottom: 14,
    marginBottom: 16,
    overflow: "hidden",
  },
  glowLine: {
    position: "absolute",
    bottom: 0,
    left: 12,
    right: 12,
    height: 3,
    borderRadius: 2,
    opacity: 0.9,
  },
  trendCard: {
    width: 148,
    backgroundColor: colors.cardElevated,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 8,
    gap: 6,
  },
  cover: {
    height: 76,
    borderRadius: radius.md - 4,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  coverEmoji: { fontSize: 34 },
  liveBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(6,6,8,0.75)",
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  liveText: { color: colors.live, fontSize: 9, letterSpacing: 1, fontWeight: "700" },
  trendTitle: { color: colors.text, fontSize: 13, fontWeight: "600", paddingHorizontal: 2 },
  trendMeta: { color: colors.textMuted, fontSize: 11, paddingHorizontal: 2 },
  trendPool: { color: colors.yesText, fontWeight: "700" },
  tiles: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  tileWrap: { alignItems: "center", gap: 5, width: 56 },
  tile: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  tileOff: {
    backgroundColor: colors.card,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  tileLabel: { color: colors.textMuted, fontSize: 10 },
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
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.cardElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { color: colors.text, fontSize: 13, fontWeight: "600" },
  rowMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowPool: { color: colors.text, fontSize: 13, fontWeight: "700" },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: 48, fontSize: 12 },
});
