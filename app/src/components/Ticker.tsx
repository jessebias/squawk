// Activity feed row (mockup style): quiet card with the latest event.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, hairline, radius } from "../theme";

export function Ticker({ message }: { message: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text} numberOfLines={1}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.card,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  text: { color: colors.textSecondary, fontSize: 11 },
});
