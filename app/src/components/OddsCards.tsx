// YES/NO stat cards with live percentages from the round pools; tapping
// selects the side the next PTT release will stake.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";

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
    pool: number,
    tint: string,
    color: string
  ) => (
    <Pressable
      onPress={() => onSelect(side)}
      style={[
        styles.card,
        { backgroundColor: tint },
        selected === side && { borderColor: color, borderWidth: 2 },
      ]}
    >
      <Text style={[styles.side, { color }]}>{side.toUpperCase()}</Text>
      <Text style={[styles.pct, { color }]}>{pct}%</Text>
      <Text style={styles.pool}>{pool.toFixed(2)} USDC</Text>
    </Pressable>
  );

  return (
    <View style={styles.row}>
      {card("yes", yesPct, yesPool, colors.yesTint, colors.yes)}
      {card("no", noPct, noPool, colors.noTint, colors.noText)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12 },
  card: {
    flex: 1,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    alignItems: "center",
    gap: 4,
  },
  side: { fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  pct: { fontSize: 34, fontWeight: "800" },
  pool: { color: colors.textSecondary, fontSize: 12 },
});
