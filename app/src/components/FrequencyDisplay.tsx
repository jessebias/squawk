// The handset's inset LCD (replaces RoundCard): channel + round meta, a
// walkie "frequency" line derived from the channel id, a giant segmented
// countdown as the live hero readout, the question, and a drain bar over
// the staking window. Board-mirror rounds (private channels) carry no
// opens_at — the timer stays exact, the drain bar approximates.
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { BN } from "@coral-xyz/anchor";
import { colors, fonts, radius } from "../theme";
import type { ChannelAccount, RoundAccount } from "../lib/squawk";

const SIGNAL_BARS = 5;

/// Stable pseudo-frequency from the channel id — pure walkie flavor.
const frequencyOf = (id: BN): string =>
  (400 + id.mod(new BN(100000)).toNumber() / 1000).toFixed(3);

const heroFor = (round: RoundAccount | null, secondsLeft: number): string => {
  if (!round) return "----";
  switch (round.status) {
    case "staking": {
      const m = Math.floor(secondsLeft / 60);
      const s = Math.ceil(secondsLeft % 60);
      return `${m}:${String(s === 60 ? 0 : s).padStart(2, "0")}`;
    }
    case "locked":
      return "LOCK";
    case "resolvedYes":
      return "YES";
    case "resolvedNo":
      return "NO";
    case "voided":
      return "VOID";
    default:
      return "----";
  }
};

export function FrequencyDisplay({
  round,
  channel,
  roundCount,
  transmitting,
  blind,
}: {
  round: RoundAccount | null;
  channel: ChannelAccount | null;
  roundCount: number;
  transmitting: boolean;
  blind: boolean;
}) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 250);
    return () => clearInterval(t);
  }, []);

  const staking = round?.status === "staking";
  const secondsLeft = round ? Math.max(0, round.locksAt.toNumber() - now) : 0;
  const window = round
    ? round.opensAt.toNumber() > 0
      ? Math.max(1, round.locksAt.toNumber() - round.opensAt.toNumber())
      : 30
    : 1;
  const frac = staking ? Math.min(1, secondsLeft / window) : 0;
  const hero = heroFor(round, secondsLeft);
  const isDigits = staking;
  const signal = channel ? Math.min(SIGNAL_BARS, channel.userCount) : 0;

  return (
    <View style={[styles.panel, transmitting && styles.panelTx]}>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          CH {channel ? channel.channelId.toString().slice(-4) : "----"}
        </Text>
        <Text style={styles.meta}>
          {round ? `RND ${round.roundIndex + 1}/${roundCount}` : "STANDBY"}
        </Text>
        <View style={styles.signalWrap}>
          {blind && <Text style={styles.blindTag}>BLIND</Text>}
          <Feather
            name="radio"
            size={11}
            color={transmitting ? colors.lcdText : colors.lcdDim}
          />
          <View style={styles.signal}>
            {Array.from({ length: SIGNAL_BARS }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.signalBar,
                  { height: 3 + i * 2 },
                  i < signal ? styles.signalOn : styles.signalOff,
                ]}
              />
            ))}
          </View>
        </View>
      </View>

      <Text style={styles.freq}>
        {channel ? frequencyOf(channel.channelId) : "---.---"} MHz
      </Text>

      <View style={styles.heroWrap}>
        {isDigits && (
          <Text style={[styles.hero, styles.heroGhost]}>8:88</Text>
        )}
        <Text style={styles.hero}>{hero}</Text>
        {transmitting && <Text style={styles.txTag}>TX ●</Text>}
      </View>

      <Text style={styles.question} numberOfLines={2}>
        {round?.question || "awaiting transmission from the host…"}
      </Text>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${frac * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.lcd,
    borderRadius: radius.sm,
    borderWidth: 1,
    // inset look: dark on top, faint light on the bottom edge
    borderColor: "#000000",
    borderBottomColor: "#26262E",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
  },
  panelTx: { borderColor: colors.lcdGlow },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  meta: { fontFamily: fonts.lcdMed, fontSize: 10, color: colors.lcdText, opacity: 0.85 },
  signalWrap: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  blindTag: {
    fontFamily: fonts.lcdMed,
    fontSize: 8,
    color: colors.lcdText,
    borderWidth: 1,
    borderColor: colors.lcdDim,
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  signal: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  signalBar: { width: 3, borderRadius: 1 },
  signalOn: { backgroundColor: colors.lcdText },
  signalOff: { backgroundColor: colors.lcdDim },
  freq: {
    fontFamily: fonts.lcdMed,
    fontSize: 12,
    color: colors.lcdText,
    opacity: 0.6,
    letterSpacing: 2,
  },
  heroWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 2 },
  hero: {
    fontFamily: fonts.lcd,
    fontSize: 52,
    color: colors.lcdText,
    letterSpacing: 3,
    textShadowColor: colors.lcdGlow,
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 0 },
  },
  heroGhost: {
    position: "absolute",
    color: colors.lcdDim,
    textShadowRadius: 0,
    textShadowColor: "transparent",
  },
  txTag: {
    position: "absolute",
    right: 0,
    top: 4,
    fontFamily: fonts.lcdMed,
    fontSize: 10,
    color: colors.lcdText,
  },
  question: {
    fontFamily: fonts.lcdMed,
    fontSize: 12,
    color: colors.lcdText,
    opacity: 0.75,
    textAlign: "center",
    lineHeight: 17,
  },
  track: {
    height: 4,
    backgroundColor: colors.lcdDim,
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 4,
  },
  fill: { height: "100%", backgroundColor: colors.lcdText, borderRadius: 2 },
});
