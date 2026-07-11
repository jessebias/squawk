// Feature feed card (ALOT reference): big photo cover, tag chips, countdown
// chip from the channel's real ends_at, title + live pool.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, hairline, radius } from "../theme";
import type { ChannelAccount } from "../lib/squawk";
import { contentFor, countdownLabel, plainTitle } from "../lib/demoContent";
import { ChannelCover } from "./ChannelCover";

type Props = {
  channel: ChannelAccount;
  onPress: () => void;
  disabled?: boolean;
};

export function FeatureCard({ channel, onPress, disabled }: Props) {
  const content = contentFor(channel.title);

  return (
    <Pressable style={styles.card} onPress={onPress} disabled={disabled}>
      <ChannelCover channel={channel} style={styles.cover} emojiSize={52} />

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {plainTitle(channel.title)}
        </Text>
        <Text style={styles.meta}>
          <Text style={styles.pool}>
            {(channel.totalPool.toNumber() / 1e6).toFixed(1)} USDC
          </Text>{" "}
          Pool · {channel.userCount} in
          {channel.status === "open" ? " · tap to join" : ""}
        </Text>
        <View style={styles.chipRow}>
          <View style={styles.tags}>
            {content.tags.map((t) => (
              <View key={t} style={styles.tag}>
                <Text style={styles.tagText}>{t}</Text>
              </View>
            ))}
          </View>
          <View style={styles.clockChip}>
            <Feather name="clock" size={11} color={colors.textSecondary} />
            <Text style={styles.clockText}>{countdownLabel(channel.endsAt.toNumber())}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 10,
    gap: 10,
  },
  cover: {
    height: 150,
    borderRadius: radius.md,
    backgroundColor: colors.cardElevated,
  },
  body: { paddingHorizontal: 2, gap: 6 },
  title: { color: colors.text, fontSize: 15, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 12 },
  pool: { color: colors.yesText, fontWeight: "700" },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  tags: { flexDirection: "row", gap: 6, flex: 1, flexWrap: "wrap" },
  tag: {
    backgroundColor: colors.cardElevated,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm - 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tagText: { color: colors.textSecondary, fontSize: 11 },
  clockChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  clockText: { color: colors.textSecondary, fontSize: 11 },
});
