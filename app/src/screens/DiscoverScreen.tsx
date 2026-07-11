// Discover: trending channels + join flow (docs/plan.md §7.1).
import React, { useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { colors, fonts, radius } from "../theme";
import { buildJoinTx, fetchChannels, type ChannelAccount } from "../lib/squawk";
import { useWallet } from "../hooks/useWallet";
import type { RootStackParamList } from "../navigators/AppNavigator";

const JOIN_AMOUNT_USDC = 10;

export function DiscoverScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const wallet = useWallet();
  const [joining, setJoining] = useState<string | null>(null);

  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      try {
        return await fetchChannels();
      } catch (e) {
        console.log("[squawk] fetchChannels failed:", e);
        throw e;
      }
    },
    refetchInterval: 4000,
  });

  const join = async (channel: ChannelAccount) => {
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
        `${String(e).slice(0, 160)}\n\nDoes this wallet hold devnet SOL + mock USDC? Fund it from Profile.`
      );
    } finally {
      setJoining(null);
    }
  };

  const open = (channel: ChannelAccount) =>
    nav.navigate("Channel", { channelPk: channel.pubkey.toBase58() });

  const renderItem = ({ item }: { item: ChannelAccount }) => {
    const live = item.status === "live";
    return (
      <Pressable
        style={styles.card}
        onPress={() => (live ? open(item) : join(item))}
        disabled={joining !== null}
      >
        <View style={styles.cardTop}>
          <Text style={styles.title}>{item.title}</Text>
          <View style={[styles.chip, live && styles.chipLive]}>
            <Text style={[styles.chipText, live && styles.chipTextLive]}>
              {live ? "● LIVE" : "OPEN"}
            </Text>
          </View>
        </View>
        <Text style={styles.meta}>
          {item.userCount} in · pool {(item.totalPool.toNumber() / 1e6).toFixed(2)} USDC
        </Text>
        <Text style={styles.action}>
          {joining === item.pubkey.toBase58()
            ? "joining…"
            : live
            ? "tap to enter"
            : `tap to join · ${JOIN_AMOUNT_USDC} USDC`}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.wordmark}>SQUAWK</Text>
      <Text style={styles.tagline}>ephemeral moments · permanent money</Text>
      <FlatList
        data={channels.data ?? []}
        keyExtractor={(c) => c.pubkey.toBase58()}
        renderItem={renderItem}
        contentContainerStyle={{ gap: 12, paddingVertical: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={channels.isFetching && !channels.data}
            onRefresh={() => channels.refetch()}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {channels.isLoading
              ? "scanning devnet…"
              : channels.error
              ? `error: ${String(channels.error).slice(0, 200)}`
              : "no channels yet — start one from the host laptop"}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: 20 },
  wordmark: {
    fontFamily: fonts.wordmark,
    fontSize: 34,
    color: colors.text,
    textShadowColor: colors.accent,
    textShadowOffset: { width: 3, height: 3 },
    textShadowRadius: 0,
  },
  tagline: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: colors.text, fontSize: 17, fontWeight: "700", flex: 1 },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chipLive: { borderColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: 11, fontWeight: "700" },
  chipTextLive: { color: colors.accent },
  meta: { color: colors.textSecondary, fontSize: 13 },
  action: { color: colors.textMuted, fontSize: 12 },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: 60 },
});
