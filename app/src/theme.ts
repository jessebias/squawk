// Design tokens — docs/plan.md §8 + the approved two-screen mockup
// (squawk_clean_ui_two_screens.html). Accent orange is ONLY for: wordmark
// shadow, live indicators, active chip, timer, PTT. Hairline borders
// everywhere; cards 12–20 radius; chips full pills; no gradients.
import { StyleSheet } from "react-native";

export const colors = {
  // premium pass: near-black canvas, higher card contrast (ALOT reference)
  background: "#060608",
  card: "#131318",
  cardElevated: "#1A1A21",
  border: "#26262E",
  text: "#FFFFFF",
  textSecondary: "#9A9AA5",
  textMuted: "#6E6E78",
  accent: "#FF6B2C",
  accentSoft: "#FFB03A",
  live: "#FF6B6B",
  yes: "#1D9E75",
  yesText: "#5DCAA5",
  yesTint: "#0F2A20",
  no: "#A34040",
  noText: "#F09595",
  noTint: "#2A1414",
} as const;

/// Orange→amber gradient for primary CTAs (start left, end right).
export const gradient = [colors.accent, colors.accentSoft] as const;

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999,
} as const;

export const hairline = StyleSheet.hairlineWidth;

export const fonts = {
  wordmark: "Bungee_400Regular", // via @expo-google-fonts/bungee + expo-font
} as const;
