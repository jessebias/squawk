// Shared channel cover: curated photo (demoContent) with the title emoji as a
// loading/failure placeholder underneath, plus the LIVE badge. Used by both the
// trending carousel cards and the feature-feed cards.
import React, { useState } from "react";
import {
  Image,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { colors, radius } from "../theme";
import { contentFor, emojiOf } from "../lib/demoContent";
import { LiveDot } from "./LiveDot";
import type { ChannelAccount } from "../lib/squawk";

type Props = {
  channel: ChannelAccount;
  style: StyleProp<ViewStyle>;
  emojiSize: number;
  compact?: boolean;
};

export function ChannelCover({ channel, style, emojiSize, compact }: Props) {
  const [failed, setFailed] = useState(false);
  const content = contentFor(channel.title);
  const showImage = content.image && !failed;
  const live = channel.status === "live";

  return (
    <View style={[styles.base, style]}>
      <Text style={{ fontSize: emojiSize }}>{emojiOf(channel.title)}</Text>
      {showImage && (
        <Image
          source={{ uri: content.image }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      )}
      {live && (
        <View style={[styles.badge, compact && styles.badgeCompact]}>
          <LiveDot size={5} />
          <Text style={styles.badgeText}>LIVE</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  badge: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(6,6,8,0.75)",
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeCompact: { top: 6, left: 6, paddingHorizontal: 7 },
  badgeText: { color: colors.live, fontSize: 9, letterSpacing: 1, fontWeight: "700" },
});
