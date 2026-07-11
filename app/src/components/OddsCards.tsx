// Compact YES/NO cards per the mockup: label + big percentage; the selected
// side gets its tint background and a 1px colored border.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, hairline, radius } from "../theme";

type Props = {
  yesPool: number;
  noPool: number;
  selected: "yes" | "no";
  onSelect: (side: "yes" | "no") => void;
};

export function OddsCards({ yesPool, noPool, selected, onSelect }: Props) {
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
    return (
      <Pressable
        onPress={() => onSelect(side)}
        style={[
          styles.card,
          on
            ? { backgroundColor: tint, borderColor: border, borderWidth: 1 }
            : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: hairline },
        ]}
      >
        <Text style={[styles.side, { color: labelColor }]}>{side.toUpperCase()}</Text>
        <Text style={styles.pct}>{pct}%</Text>
        <Text style={styles.pool}>
          {(side === "yes" ? yesPool : noPool).toFixed(2)}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.row}>
      {card("yes", yesPct, colors.yesText, colors.yesTint, colors.yes)}
      {card("no", noPct, colors.noText, colors.noTint, colors.no)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  card: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: "center",
    gap: 2,
  },
  side: { fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  pct: { fontSize: 26, fontWeight: "800", color: colors.text },
  pool: { fontSize: 10, color: colors.textMuted },
});
