// Push-to-talk staking — docs/plan.md §7.2. Hold: the stake accumulates
// (0 → 2.00 USDC, +0.03/50ms) with haptic ticks every 0.25; release locks it
// in on the selected side via the session key (zero popups, zero fees).
import React, { useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { colors } from "../theme";

const GROWTH_PER_TICK = 0.03;
const TICK_MS = 50;
const CAP = 2.0;
const MIN_STAKE = 0.02;

type Props = {
  disabled: boolean;
  side: "yes" | "no";
  onStake: (amountUsdc: number) => void;
};

export function PTTButton({ disabled, side, onStake }: Props) {
  const [holding, setHolding] = useState(false);
  const [amount, setAmount] = useState(0);
  const amountRef = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickMark = useRef(0);
  const scale = useRef(new Animated.Value(1)).current;

  const start = () => {
    if (disabled) return;
    setHolding(true);
    amountRef.current = 0;
    lastTickMark.current = 0;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.spring(scale, { toValue: 1.15, useNativeDriver: true }).start();
    timer.current = setInterval(() => {
      amountRef.current = Math.min(CAP, amountRef.current + GROWTH_PER_TICK);
      setAmount(amountRef.current);
      if (amountRef.current - lastTickMark.current >= 0.25) {
        lastTickMark.current = amountRef.current;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    }, TICK_MS);
  };

  const release = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setHolding(false);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
    const staked = amountRef.current;
    amountRef.current = 0;
    setAmount(0);
    if (staked >= MIN_STAKE) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onStake(Number(staked.toFixed(2)));
    }
  };

  return (
    <View style={styles.wrap}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          onPressIn={start}
          onPressOut={release}
          disabled={disabled}
          style={[styles.button, disabled && styles.disabled, holding && styles.holding]}
        >
          <Text style={styles.mic}>🎙️</Text>
          <Text style={styles.label}>
            {holding ? `${amount.toFixed(2)} USDC` : "HOLD TO STAKE"}
          </Text>
        </Pressable>
      </Animated.View>
      <Text style={styles.hint}>
        {disabled
          ? "staking closed"
          : `release stakes ${side.toUpperCase()} · max ${CAP.toFixed(2)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 10 },
  button: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  holding: { backgroundColor: "#FF8A50" },
  disabled: { backgroundColor: colors.border },
  mic: { fontSize: 34 },
  label: { color: "#FFFFFF", fontWeight: "700", fontSize: 12, marginTop: 4 },
  hint: { color: colors.textMuted, fontSize: 12 },
});
