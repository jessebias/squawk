// Design tokens — docs/plan.md §8. Accent orange is ONLY for: wordmark shadow, live
// indicators, active chip, timer, PTT. Wordmark uses Bungee; all other text is
// the system sans. Cards radius 16–20, chips are full pills, no gradients.
export const colors = {
  background: "#0D0D10",
  card: "#17171C",
  border: "#26262E",
  text: "#FFFFFF",
  textSecondary: "#9A9AA5",
  textMuted: "#6E6E78",
  accent: "#FF6B2C",
  yes: "#1D9E75",
  yesTint: "#0F2A20",
  no: "#A34040",
  noText: "#F09595",
  noTint: "#2A1414",
} as const;

export const radius = {
  card: 18,
  pill: 999,
} as const;

export const fonts = {
  wordmark: "Bungee_400Regular", // via @expo-google-fonts/bungee + expo-font
} as const;
