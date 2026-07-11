// Auto-scrolling activity strip (dare-app reference): full-bleed marquee under
// the header. The item sequence renders twice back-to-back and slides on a
// seamless linear loop, moving left → right at a constant ~40 px/s. Built on
// the RN Animated API (same as LiveDot / SplashScreen); no reanimated. Items
// are repeated until one copy is wide enough to cover the viewport so the
// wrap never shows a gap.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { colors, hairline } from "../theme";
import { LiveDot } from "./LiveDot";

const SPEED_PX_PER_S = 40;
const MIN_ENTRIES = 6; // pad short lists so one strip copy spans the screen

export type TickerItem = { text: string; meta?: string; live?: boolean };

type Props = { items: TickerItem[]; style?: StyleProp<ViewStyle> };

function Strip({
  entries,
  onWidth,
}: {
  entries: TickerItem[];
  onWidth?: (w: number) => void;
}) {
  return (
    <View
      style={styles.strip}
      onLayout={onWidth ? (e) => onWidth(e.nativeEvent.layout.width) : undefined}
    >
      {entries.map((item, i) => (
        <View key={`${item.text}-${i}`} style={styles.item}>
          {item.live && <LiveDot size={5} />}
          <Text style={styles.text} numberOfLines={1}>
            {item.text}
            {item.meta ? <Text style={styles.meta}> {item.meta}</Text> : null}
          </Text>
          <Text style={styles.sep}>·</Text>
        </View>
      ))}
    </View>
  );
}

export function ActivityTicker({ items, style }: Props) {
  const [width, setWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;

  const entries = useMemo(() => {
    if (items.length === 0) return items;
    const repeats = Math.max(1, Math.ceil(MIN_ENTRIES / items.length));
    return Array.from({ length: repeats }, () => items).flat();
  }, [items]);

  useEffect(() => {
    if (width <= 0) return;
    translateX.setValue(-width);
    const loop = Animated.loop(
      Animated.timing(translateX, {
        toValue: 0,
        duration: (width / SPEED_PX_PER_S) * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [width, translateX]);

  if (entries.length === 0) return null;

  return (
    <View style={[styles.wrap, style]}>
      <Animated.View style={[styles.row, { transform: [{ translateX }] }]}>
        <Strip
          entries={entries}
          onWidth={(w) => setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev))}
        />
        <Strip entries={entries} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: hairline,
    borderBottomWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: "hidden",
  },
  row: { flexDirection: "row" },
  strip: { flexDirection: "row", alignItems: "center", paddingVertical: 9 },
  item: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12 },
  text: { color: colors.text, fontSize: 11, fontWeight: "600" },
  meta: { color: colors.textMuted, fontWeight: "500" },
  sep: { color: colors.textMuted, fontSize: 11, paddingLeft: 12 },
});
