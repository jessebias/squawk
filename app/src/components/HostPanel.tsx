// Host controls — rendered in ChannelScreen when this device's host burner
// owns the channel. Drives the same lifecycle as scripts/host-demo.ts, from
// the phone: GO LIVE (delegate to ER) → ask questions → resolve YES/NO →
// end & settle. Every ER send feeds the footer tx counter via onErTx.
import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { Keypair } from "@solana/web3.js";
import { colors, gradient, hairline, radius } from "../theme";
import {
  closeChannelOnEr,
  describeError,
  goLiveAndDelegate,
  hostErConn,
  openRoundOnEr,
  resolveRoundOnEr,
} from "../lib/host";
import { haptic } from "../lib/haptics";
import type { ChannelAccount, RoundAccount } from "../lib/squawk";

const MAX_QUESTION_BYTES = 128;
const WINDOWS = [15, 30, 60];
const SUGGESTIONS = [
  "Shot on goal in the next 2 minutes?",
  "Someone laughs on camera?",
  "Demo crashes before the timer?",
];

export function HostPanel({
  channel,
  round,
  hostKey,
  onErTx,
}: {
  channel: ChannelAccount;
  round: RoundAccount | null;
  hostKey: Keypair;
  onErTx: (n: number) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [windowSecs, setWindowSecs] = useState(15);

  const run = async (label: string, action: () => Promise<number | void>) => {
    if (busy) return;
    setBusy(label);
    setError(null);
    haptic.tap();
    try {
      const txs = await action();
      if (typeof txs === "number" && txs > 0) onErTx(txs);
      haptic.success();
    } catch (e) {
      haptic.error();
      setError(describeError(e).slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  // ER routing: private channels talk to the TEE through the host's
  // token-authenticated connection
  const withEr = (fn: (er: any) => Promise<number | void>) => async () =>
    fn(await hostErConn(hostKey, channel));

  const now = Math.floor(Date.now() / 1000);
  const questionBytes = Buffer.byteLength(question, "utf8");
  const overQuestion = questionBytes > MAX_QUESTION_BYTES;

  // next askable round: the pre-created pending round, or the one after a
  // resolved/voided round — capped at the rounds bought at creation
  const nextIndex =
    round === null || round.status === "pending"
      ? channel.activeRound
      : ["resolvedYes", "resolvedNo", "voided"].includes(round.status)
      ? channel.activeRound + 1
      : null;
  const roundsLeft = nextIndex !== null && nextIndex < channel.roundCount;
  const staking = round?.status === "staking";
  const locksAt = round?.locksAt.toNumber() ?? 0;
  const canResolve =
    round !== null && (round.status === "locked" || (staking && now >= locksAt));

  return (
    <View style={styles.panel}>
      <View style={styles.headRow}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>HOST</Text>
        </View>
        {channel.visibility === 1 && (
          <View style={[styles.chip, { borderColor: colors.border }]}>
            <Text style={[styles.chipText, { color: colors.textSecondary }]}>🔒 BLIND</Text>
          </View>
        )}
        {busy && <Text style={styles.busyText}>{busy}</Text>}
      </View>
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {channel.status === "open" && (
        <>
          <Text style={styles.info}>
            {channel.userCount} joined · going live locks entries
          </Text>
          <Pressable
            disabled={!!busy}
            onPress={() =>
              run("going live…", async () => {
                await goLiveAndDelegate(hostKey, channel, setBusy);
              })
            }
          >
            <LinearGradient
              colors={[...gradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.cta, busy && { opacity: 0.4 }]}
            >
              <Text style={styles.ctaText}>GO LIVE</Text>
            </LinearGradient>
          </Pressable>
        </>
      )}

      {channel.status === "live" && (
        <>
          {roundsLeft && nextIndex !== null && !staking && !canResolve && (
            <>
              <View style={styles.labelRow}>
                <Text style={styles.label}>
                  QUESTION {nextIndex + 1}/{channel.roundCount}
                </Text>
                <Text style={[styles.counter, overQuestion && { color: colors.noText }]}>
                  {questionBytes}/{MAX_QUESTION_BYTES}
                </Text>
              </View>
              <TextInput
                style={styles.input}
                placeholder="What happens next?"
                placeholderTextColor={colors.textMuted}
                value={question}
                onChangeText={setQuestion}
                editable={!busy}
              />
              <View style={styles.chipsRow}>
                {SUGGESTIONS.map((s) => (
                  <Pressable key={s} onPress={() => setQuestion(s)} disabled={!!busy}>
                    <Text style={styles.suggestion} numberOfLines={1}>
                      {s}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.windowRow}>
                {WINDOWS.map((w) => {
                  const on = w === windowSecs;
                  return (
                    <Pressable
                      key={w}
                      onPress={() => setWindowSecs(w)}
                      disabled={!!busy}
                      style={[styles.windowPill, on && styles.windowPillOn]}
                    >
                      <Text style={[styles.windowText, on && { color: colors.text }]}>
                        {w}s
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  style={{ flex: 1 }}
                  disabled={!!busy || question.trim().length === 0 || overQuestion}
                  onPress={() =>
                    run(
                      "asking…",
                      withEr(async (er) => {
                        const txs = await openRoundOnEr(
                          hostKey,
                          channel.pubkey,
                          nextIndex,
                          question.trim(),
                          windowSecs,
                          er
                        );
                        setQuestion("");
                        return txs;
                      })
                    )
                  }
                >
                  <LinearGradient
                    colors={[...gradient]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[
                      styles.ask,
                      (busy || question.trim().length === 0 || overQuestion) && {
                        opacity: 0.4,
                      },
                    ]}
                  >
                    <Text style={styles.ctaText}>ASK</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </>
          )}

          {!roundsLeft && !staking && !canResolve && (
            <Text style={styles.info}>all {channel.roundCount} rounds played</Text>
          )}

          {staking && now < locksAt && (
            <Text style={styles.info}>locks in {locksAt - now}s — hands off, host</Text>
          )}

          {canResolve && round && (
            <>
              <Text style={styles.info}>make the call — round {round.roundIndex + 1}</Text>
              <View style={styles.resolveRow}>
                <Pressable
                  style={[styles.resolve, styles.resolveYes, busy && { opacity: 0.4 }]}
                  disabled={!!busy}
                  onPress={() =>
                    run(
                      "resolving YES…",
                      withEr((er) =>
                        resolveRoundOnEr(hostKey, channel.pubkey, round.roundIndex, "yes", er)
                      )
                    )
                  }
                >
                  <Text style={[styles.resolveText, { color: colors.yesText }]}>YES</Text>
                </Pressable>
                <Pressable
                  style={[styles.resolve, styles.resolveNo, busy && { opacity: 0.4 }]}
                  disabled={!!busy}
                  onPress={() =>
                    run(
                      "resolving NO…",
                      withEr((er) =>
                        resolveRoundOnEr(hostKey, channel.pubkey, round.roundIndex, "no", er)
                      )
                    )
                  }
                >
                  <Text style={[styles.resolveText, { color: colors.noText }]}>NO</Text>
                </Pressable>
              </View>
            </>
          )}

          <Pressable
            disabled={!!busy}
            onPress={() =>
              Alert.alert(
                "End channel?",
                "Settles everything back to Solana. Players collect from Profile.",
                [
                  { text: "Keep playing", style: "cancel" },
                  {
                    text: "End & settle",
                    style: "destructive",
                    onPress: () =>
                      run(
                        "settling…",
                        withEr((er) =>
                          closeChannelOnEr(
                            hostKey,
                            channel.pubkey,
                            channel.roundCount,
                            setBusy,
                            er
                          )
                        )
                      ),
                  },
                ]
              )
            }
          >
            <Text style={styles.endLink}>End channel & settle</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.card,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 12,
    gap: 10,
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: {
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipText: { color: colors.accent, fontSize: 9, letterSpacing: 1.5, fontWeight: "700" },
  busyText: { color: colors.textSecondary, fontSize: 11 },
  info: { color: colors.textSecondary, fontSize: 12 },
  cta: { borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  ctaText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700", letterSpacing: 1 },
  labelRow: { flexDirection: "row", justifyContent: "space-between" },
  label: { color: colors.textMuted, fontSize: 10, letterSpacing: 1.2, fontWeight: "600" },
  counter: { color: colors.textMuted, fontSize: 10 },
  input: {
    backgroundColor: colors.cardElevated,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 13,
  },
  chipsRow: { gap: 4 },
  suggestion: { color: colors.textMuted, fontSize: 11 },
  windowRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  windowPill: {
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.cardElevated,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  windowPillOn: { borderColor: colors.accent },
  windowText: { color: colors.textSecondary, fontSize: 11, fontWeight: "600" },
  ask: { borderRadius: radius.pill, paddingVertical: 9, alignItems: "center" },
  resolveRow: { flexDirection: "row", gap: 10 },
  resolve: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: hairline,
  },
  resolveYes: { backgroundColor: colors.yesTint, borderColor: colors.yes },
  resolveNo: { backgroundColor: colors.noTint, borderColor: colors.no },
  resolveText: { fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  endLink: { color: colors.textMuted, fontSize: 11, textAlign: "center", paddingTop: 2 },
  errorBox: {
    backgroundColor: colors.noTint,
    borderWidth: hairline,
    borderColor: colors.no,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  errorText: { color: colors.noText, fontSize: 11 },
});
