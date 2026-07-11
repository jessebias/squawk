// Explore / Activity placeholders — visually consistent, honest about scope.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme";

export function makePlaceholder(title: string, icon: keyof typeof Feather.glyphMap) {
  return function Placeholder() {
    return (
      <View style={styles.screen}>
        <Feather name={icon} size={28} color={colors.textMuted} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>coming after the hackathon 🎙️</Text>
      </View>
    );
  };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: "600" },
  sub: { color: colors.textMuted, fontSize: 12 },
});
