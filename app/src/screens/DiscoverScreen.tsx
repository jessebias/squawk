// Discover — header, search, trending carousel, category tiles, then the
// feature feed (ALOT reference): big cover cards with tag chips + countdowns.
// Category tiles filter the feed via demoContent's title→category map.
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
import { contentFor, plainTitle } from "../lib/demoContent";
import { useWallet } from "../hooks/useWallet";
import { FeatureCard } from "../components/FeatureCard";
import { ChannelCover } from "../components/ChannelCover";
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
  const catLabel = CATEGORIES[category].label;
  const feed = useMemo(
    () =>
      catLabel === "All"
        ? filtered
        : filtered.filter((c) => contentFor(c.title).category === catLabel),
    [filtered, catLabel]
  );

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
        <ChannelCover channel={c} style={styles.cover} emojiSize={34} compact />
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

  const header = (
    <View>
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
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={feed}
        keyExtractor={(c) => c.pubkey.toBase58()}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <FeatureCard
            channel={item}
            onPress={() => open(item)}
            disabled={joining !== null}
          />
        )}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {channels.isLoading
              ? "scanning devnet…"
              : channels.error
              ? `error: ${String(channels.error).slice(0, 160)}`
              : catLabel !== "All" && filtered.length > 0
              ? `no ${catLabel.toLowerCase()} channels right now`
              : "no channels yet — start one from the host laptop"}
          </Text>
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
  },
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
  empty: { color: colors.textMuted, textAlign: "center", marginTop: 48, fontSize: 12 },
});
