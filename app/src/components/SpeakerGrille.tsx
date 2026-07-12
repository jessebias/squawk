// The speaker grille: columns of dots with a top→bottom brightness wave.
// idle = static dim · active (round staking) = slow shimmer ·
// transmitting (PTT held) = fast orange ripple. Native-driver opacity only.
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { colors } from "../theme";

const COLS = 7;
const ROWS = 6;

export function SpeakerGrille({
  active,
  transmitting,
}: {
  active: boolean;
  transmitting: boolean;
}) {
  const wave = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active && !transmitting) {
      wave.stopAnimation();
      wave.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(wave, {
        toValue: ROWS,
        duration: transmitting ? 550 : 1800,
        useNativeDriver: true,
      })
    );
    wave.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [active, transmitting]);

  const animated = active || transmitting;
  const dotColor = transmitting ? colors.accent : colors.textMuted;

  return (
    <View style={styles.grille}>
      {Array.from({ length: ROWS }, (_, r) => {
        // each row brightens as the wave passes through it
        const opacity = animated
          ? wave.interpolate({
              inputRange: [r - 1.5, r, r + 1.5],
              outputRange: [0.25, transmitting ? 1 : 0.7, 0.25],
              extrapolate: "clamp",
            })
          : 0.25;
        return (
          <Animated.View key={r} style={[styles.row, { opacity }]}>
            {Array.from({ length: COLS }, (_, c) => (
              <View key={c} style={[styles.dot, { backgroundColor: dotColor }]} />
            ))}
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grille: { gap: 7, alignItems: "center", paddingVertical: 2 },
  row: { flexDirection: "row", gap: 26 },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
