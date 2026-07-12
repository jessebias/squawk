// The active micro-question: "Round N of M", countdown, and a draining
// progress bar over the staking window (mockup style).
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, hairline, radius } from "../theme";
import type { RoundAccount } from "../lib/squawk";

const STATUS_LABEL: Record<string, string> = {
  pending: "WAITING FOR HOST",
  locked: "LOCKED",
  resolvedYes: "RESOLVED — YES",
  resolvedNo: "RESOLVED — NO",
  voided: "VOIDED · REFUNDED",
};

export function RoundCard({
  round,
  roundCount,
}: {
  round: RoundAccount | null;
  roundCount: number;
}) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 250);
    return () => clearInterval(t);
  }, []);

  const staking = round?.status === "staking";
  const secondsLeft = round ? Math.max(0, round.locksAt.toNumber() - now) : 0;
  // Board-mirror rounds (private channels) carry no opens_at — approximate
  // the staking window so the drain bar still reads; the timer stays exact.
  const window = round
    ? round.opensAt.toNumber() > 0
      ? Math.max(1, round.locksAt.toNumber() - round.opensAt.toNumber())
      : 30
    : 1;
  const frac = staking ? Math.min(1, secondsLeft / window) : 0;

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.counter}>
          {round ? `Round ${round.roundIndex + 1} of ${roundCount}` : "…"}
        </Text>
        {staking ? (
          <View style={styles.timerPill}>
            <Text style={styles.timer}>
              0:{String(Math.ceil(secondsLeft)).padStart(2, "0")}
            </Text>
          </View>
        ) : (
          <Text style={styles.status}>{round ? STATUS_LABEL[round.status] : ""}</Text>
        )}
      </View>
      <Text style={styles.question}>
        {round?.question || "Next round is coming up…"}
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${frac * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: hairline,
    borderColor: colors.border,
    padding: 18,
    gap: 12,
  },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  counter: { color: colors.textMuted, fontSize: 11 },
  timerPill: {
    backgroundColor: "rgba(255,107,44,0.12)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  timer: { color: colors.accent, fontSize: 12, fontWeight: "700" },
  status: { color: colors.textSecondary, fontSize: 11, fontWeight: "600", letterSpacing: 1 },
  question: { color: colors.text, fontSize: 17, fontWeight: "600", lineHeight: 24 },
  track: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: "hidden",
  },
  fill: { height: "100%", backgroundColor: colors.accent, borderRadius: 3 },
});
