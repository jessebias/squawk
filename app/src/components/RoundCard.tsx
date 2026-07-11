// The active micro-question with a live countdown to lock.
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";
import type { RoundAccount } from "../lib/squawk";

const STATUS_LABEL: Record<string, string> = {
  pending: "WAITING FOR HOST",
  staking: "LIVE",
  locked: "LOCKED",
  resolvedYes: "RESOLVED — YES",
  resolvedNo: "RESOLVED — NO",
  voided: "VOIDED · REFUNDED",
};

export function RoundCard({ round }: { round: RoundAccount | null }) {
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 250);
    return () => clearInterval(t);
  }, []);

  const staking = round?.status === "staking";
  const secondsLeft = round ? Math.max(0, round.locksAt.toNumber() - now) : 0;

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <Text style={[styles.status, staking && styles.statusLive]}>
          {round ? STATUS_LABEL[round.status] : "…"}
        </Text>
        {staking && <Text style={styles.timer}>{secondsLeft}s</Text>}
      </View>
      <Text style={styles.question}>
        {round?.question || "Next round is coming up…"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 10,
  },
  topRow: { flexDirection: "row", justifyContent: "space-between" },
  status: { color: colors.textMuted, fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  statusLive: { color: colors.accent },
  timer: { color: colors.accent, fontSize: 14, fontWeight: "800" },
  question: { color: colors.text, fontSize: 19, fontWeight: "600", lineHeight: 26 },
});
