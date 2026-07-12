// YES/NO as hardware buttons on the walkie's device face: beveled edges,
// an LED indicator that lights when the side is selected, pressed-in inset
// on the selected side. `hidden` = private-channel blind mode: the pools are
// unreadable on the TEE while the round is staking, so both cards show "?" —
// the side selection still works (that's the blind bet).
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, hairline, radius } from "../theme";

type Props = {
  yesPool: number;
  noPool: number;
  selected: "yes" | "no";
  onSelect: (side: "yes" | "no") => void;
  hidden?: boolean;
};

export function OddsCards({ yesPool, noPool, selected, onSelect, hidden }: Props) {
  const total = yesPool + noPool;
  const yesPct = total === 0 ? 50 : Math.round((yesPool / total) * 100);
  const noPct = total === 0 ? 50 : 100 - yesPct;

  const card = (
    side: "yes" | "no",
    pct: number,
    labelColor: string,
    tint: string,
    border: string
  ) => {
    const on = selected === side;
    const pool = side === "yes" ? yesPool : noPool;
    return (
      <Pressable
        onPress={() => onSelect(side)}
        style={[
          styles.card,
          on
            ? { backgroundColor: tint, borderColor: border, ...styles.cardPressed }
            : { backgroundColor: colors.cardElevated, borderColor: colors.bodyEdge },
        ]}
      >
        <View style={styles.ledRow}>
          <View
            style={[
              styles.led,
              on
                ? { backgroundColor: labelColor, shadowColor: labelColor }
                : styles.ledOff,
            ]}
          />
          <Text style={[styles.side, { color: labelColor }]}>{side.toUpperCase()}</Text>
        </View>
        <Text style={styles.pct}>{hidden ? "?" : `${pct}%`}</Text>
        <Text style={styles.pool}>
          {hidden ? "hidden until the call" : total === 0 ? "no stakes yet" : pool.toFixed(2)}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {card("yes", yesPct, colors.yesText, colors.yesTint, colors.yes)}
        {card("no", noPct, colors.noText, colors.noTint, colors.no)}
      </View>
      {hidden && (
        <View style={styles.blindRow}>
          <Feather name="eye-off" size={11} color={colors.textMuted} />
          <Text style={styles.blindText}>blind round — odds reveal at the call</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: "row", gap: 10 },
  card: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    // raised hardware button: light top edge, dark bottom edge
    borderTopColor: "#3A3A46",
    borderBottomColor: "#101014",
    paddingVertical: 13,
    alignItems: "center",
    gap: 2,
  },
  cardPressed: {
    // pressed-in: highlight flips to the bottom edge
    borderTopColor: "#101014",
    borderBottomColor: "#3A3A46",
  },
  ledRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  led: {
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowOpacity: 0.9,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  ledOff: { backgroundColor: colors.border },
  side: { fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  pct: { fontSize: 26, fontWeight: "800", color: colors.text },
  pool: { fontSize: 10, color: colors.textMuted },
  blindRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  blindText: { color: colors.textMuted, fontSize: 10 },
});
