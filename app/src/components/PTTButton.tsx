// Push-to-talk staking — docs/plan.md §7.2, styled per the approved mockup:
// orange circle with mic + HOLD (Bungee) + live amount; the button grows as
// the stake accumulates (scale 1 + amount·0.05). Haptic ticks every 0.25.
import React, { useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { colors, fonts, gradient } from "../theme";

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
    timer.current = setInterval(() => {
      amountRef.current = Math.min(CAP, amountRef.current + GROWTH_PER_TICK);
      setAmount(amountRef.current);
      scale.setValue(1 + amountRef.current * 0.05);
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
      <Animated.View style={[styles.glow, { transform: [{ scale }] }]}>
        <Pressable onPressIn={start} onPressOut={release} disabled={disabled}>
          <LinearGradient
            colors={disabled ? [colors.cardElevated, colors.cardElevated] : [...gradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.button}
          >
            <Feather
              name="mic"
              size={24}
              color={disabled ? colors.textMuted : "#FFFFFF"}
            />
            <Text style={[styles.hold, disabled && { color: colors.textMuted }]}>
              HOLD
            </Text>
            <Text style={styles.amount}>{holding ? amount.toFixed(2) : " "}</Text>
          </LinearGradient>
        </Pressable>
      </Animated.View>
      <Text style={styles.hint}>
        {disabled
          ? "staking closed"
          : `Hold to stake · release to lock ${side.toUpperCase()}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 10 },
  glow: {
    borderRadius: 60,
    shadowColor: colors.accent,
    shadowOpacity: 0.55,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 16,
  },
  button: {
    width: 116,
    height: 116,
    borderRadius: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  hold: { fontFamily: fonts.wordmark, fontSize: 12, color: "#FFFFFF", marginTop: 3 },
  amount: { fontSize: 11, color: "#4A1B0C", fontWeight: "700", minHeight: 14 },
  hint: { color: colors.textMuted, fontSize: 11 },
});
