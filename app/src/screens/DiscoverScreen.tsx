// Discover — header, scrolling activity ticker, search, trending carousel,
// category tiles, then the feature feed (ALOT reference): big cover cards
// with tag chips + countdowns.
// Category tiles filter the feed via demoContent's title→category map.
import React, { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PublicKey } from "@solana/web3.js";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { colors, gradient, hairline, radius } from "../theme";
import { buildJoinTx, fetchChannels, type ChannelAccount } from "../lib/squawk";
import { haptic } from "../lib/haptics";
import { contentFor, plainTitle } from "../lib/demoContent";
import { useWallet } from "../hooks/useWallet";
import { FeatureCard } from "../components/FeatureCard";
import { ChannelCover } from "../components/ChannelCover";
import { AppHeader } from "../components/AppHeader";
import { ActivityTicker, type TickerItem } from "../components/ActivityTicker";
import { Skeleton } from "../components/Skeleton";
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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);

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
  const tickerItems = useMemo<TickerItem[]>(
    () =>
      (channels.data ?? []).map((c) => {
        const pool = (c.totalPool.toNumber() / 1e6).toFixed(1);
        const live = c.status === "live";
        return {
          text: plainTitle(c.title).toUpperCase(),
          meta: live ? `${pool} USDC POOL` : `${pool} USDC · JOIN 10`,
          live,
        };
      }),
    [channels.data]
  );
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
      haptic.success();
      nav.navigate("Channel", { channelPk: channel.pubkey.toBase58() });
    } catch (e) {
      haptic.error();
      Alert.alert(
        "Join failed",
        `${String(e).slice(0, 140)}\n\nFund this wallet from Profile (needs devnet SOL + mock USDC).`
      );
    } finally {
      setJoining(null);
    }
  };

  // unlisted private channels are reached by pasting the invite code (the
  // channel pubkey) or the squawk://channel/<pk> deep link
  const openInvite = () => {
    const raw = inviteCode.trim().replace(/^squawk:\/\/channel\//i, "");
    try {
      const pk = new PublicKey(raw);
      setInviteOpen(false);
      setInviteCode("");
      setInviteError(null);
      nav.navigate("Channel", { channelPk: pk.toBase58() });
    } catch {
      setInviteError("that doesn't look like a channel code");
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

      <ActivityTicker items={tickerItems} style={styles.ticker} />

      <View style={styles.search}>
        <Feather name="search" size={15} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search channels"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        <Pressable onPress={() => setInviteOpen(true)} hitSlop={8}>
          <Feather name="key" size={15} color={colors.textMuted} />
        </Pressable>
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
      <Modal
        visible={inviteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setInviteOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHead}>
              <Feather name="lock" size={14} color={colors.accent} />
              <Text style={styles.modalTitle}>Join a private channel</Text>
            </View>
            <Text style={styles.modalHint}>
              paste the invite code or squawk:// link the host shared
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="channel code"
              placeholderTextColor={colors.textMuted}
              value={inviteCode}
              onChangeText={(t) => {
                setInviteCode(t);
                setInviteError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {inviteError && <Text style={styles.modalError}>{inviteError}</Text>}
            <Pressable onPress={openInvite} disabled={inviteCode.trim().length === 0}>
              <LinearGradient
                colors={[...gradient]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.modalCta, inviteCode.trim().length === 0 && { opacity: 0.4 }]}
              >
                <Text style={styles.modalCtaText}>OPEN CHANNEL</Text>
              </LinearGradient>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
          channels.isLoading ? (
            <View style={{ gap: 12 }}>
              <Skeleton height={180} />
              <Skeleton height={180} style={{ opacity: 0.6 }} />
            </View>
          ) : (
            <Text style={styles.empty}>
              {channels.error
                ? `error: ${String(channels.error).slice(0, 160)}`
                : catLabel !== "All" && filtered.length > 0
                ? `no ${catLabel.toLowerCase()} channels right now`
                : "no channels yet — tap + to start one"}
            </Text>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 8 },
  ticker: { marginHorizontal: -16, marginBottom: 14 },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: colors.card,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: 18,
    gap: 10,
  },
  modalHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  modalTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  modalHint: { color: colors.textMuted, fontSize: 11 },
  modalInput: {
    backgroundColor: colors.cardElevated,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 12,
  },
  modalError: { color: colors.noText, fontSize: 11 },
  modalCta: { borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  modalCtaText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700", letterSpacing: 1 },
});
