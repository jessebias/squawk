// Opening splash — brand handoff from the native splash to the app. The Bungee
// wordmark scales + fades in with its signature orange shadow over the near-black
// canvas, the tagline follows, then the overlay fades to reveal the app. Built on
// the RN Animated API (same as PTTButton / LiveDot); no reanimated dependency.
// Auto-dismisses via onFinish.
import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet } from "react-native";
import { colors, fonts } from "../theme";

type Props = { onFinish: () => void };

export function SplashScreen({ onFinish }: Props) {
  const wordmarkScale = useRef(new Animated.Value(0.85)).current;
  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const intro = Animated.sequence([
      Animated.parallel([
        Animated.spring(wordmarkScale, {
          toValue: 1,
          friction: 6,
          tension: 60,
          useNativeDriver: true,
        }),
        Animated.timing(wordmarkOpacity, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(taglineOpacity, {
        toValue: 1,
        duration: 340,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.delay(700),
    ]);

    intro.start(() => {
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 420,
        useNativeDriver: true,
      }).start(() => onFinish());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[styles.overlay, { opacity: overlayOpacity }]}
      pointerEvents="none"
    >
      <Animated.Text
        style={[
          styles.wordmark,
          { opacity: wordmarkOpacity, transform: [{ scale: wordmarkScale }] },
        ]}
      >
        SQUAWK
      </Animated.Text>
      <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]}>
        MICRO PREDICTION MARKETS
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  wordmark: {
    fontFamily: fonts.wordmark,
    fontSize: 52,
    color: colors.text,
    textShadowColor: colors.accent,
    textShadowOffset: { width: 3, height: 3 },
    textShadowRadius: 0,
  },
  tagline: {
    marginTop: 20,
    fontSize: 11,
    letterSpacing: 3,
    color: colors.textMuted,
    fontWeight: "600",
  },
});
