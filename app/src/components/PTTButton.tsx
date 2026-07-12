// Push-to-talk staking — docs/plan.md §7.2, restyled as the walkie-talkie's
// hardware transmit button: concentric bezel ring + gradient face, pressed-in
// look while held. The mechanics are unchanged: the stake grows while held
// (scale 1 + amount·0.05), haptic ticks every 0.25, release locks it in.
// onHoldChange lets the handset (grille/LCD) react to transmission.
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
  onHoldChange?: (holding: boolean) => void;
};

export function PTTButton({ disabled, side, onStake, onHoldChange }: Props) {
  const [holding, setHolding] = useState(false);
  const [amount, setAmount] = useState(0);
  const amountRef = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickMark = useRef(0);
  const scale = useRef(new Animated.Value(1)).current;

  const start = () => {
    if (disabled) return;
    setHolding(true);
    onHoldChange?.(true);
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
    onHoldChange?.(false);
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
        {/* hardware bezel: raised outer ring the button sits inside */}
        <View style={[styles.bezel, holding && styles.bezelHeld]}>
          <Pressable onPressIn={start} onPressOut={release} disabled={disabled}>
            <LinearGradient
              colors={disabled ? [colors.cardElevated, colors.cardElevated] : [...gradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.button, holding && styles.buttonHeld]}
            >
              {holding ? (
                // the stake grows live under your thumb — the whole point
                <>
                  <Text style={styles.bigAmount}>{amount.toFixed(2)}</Text>
                  <Text style={styles.usdcTag}>USDC</Text>
                </>
              ) : (
                <>
                  <Feather
                    name="mic"
                    size={26}
                    color={disabled ? colors.textMuted : "#FFFFFF"}
                  />
                  <Text style={[styles.hold, disabled && { color: colors.textMuted }]}>
                    HOLD{"\n"}TO STAKE
                  </Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      </Animated.View>
      <Text style={styles.hint}>
        {disabled
          ? "staking closed"
          : holding
          ? `transmitting ${side.toUpperCase()} · ${amount.toFixed(2)} USDC`
          : `Hold to stake · release to lock ${side.toUpperCase()}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 10 },
  glow: {
    borderRadius: 78,
    shadowColor: colors.accent,
    shadowOpacity: 0.55,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 16,
  },
  bezel: {
    width: 152,
    height: 152,
    borderRadius: 76,
    backgroundColor: colors.body,
    borderWidth: 1,
    borderColor: colors.bodyEdge,
    borderTopColor: "#3A3A46",
    borderBottomColor: "#1A1A22",
    alignItems: "center",
    justifyContent: "center",
  },
  bezelHeld: {
    // pressed-in: the highlight flips to the bottom edge
    borderTopColor: "#1A1A22",
    borderBottomColor: "#3A3A46",
  },
  button: {
    width: 126,
    height: 126,
    borderRadius: 63,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonHeld: { opacity: 0.92 },
  hold: {
    fontFamily: fonts.wordmark,
    fontSize: 12,
    color: "#FFFFFF",
    marginTop: 3,
    textAlign: "center",
    lineHeight: 15,
  },
  bigAmount: {
    fontFamily: fonts.lcd,
    fontSize: 30,
    color: "#FFFFFF",
    textShadowColor: "#4A1B0C",
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 0 },
  },
  usdcTag: {
    fontFamily: fonts.lcdMed,
    fontSize: 10,
    color: "#4A1B0C",
    letterSpacing: 2,
  },
  hint: { color: colors.textMuted, fontSize: 11 },
});
