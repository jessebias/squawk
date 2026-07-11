// Single-line activity ticker (latest event).
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

export function Ticker({ message }: { message: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.dot}>●</Text>
      <Text style={styles.text} numberOfLines={1}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  dot: { color: colors.accent, fontSize: 8 },
  text: { color: colors.textSecondary, fontSize: 13, flex: 1 },
});
