// Blinking live indicator dot (mockup's 1.2s blink animation).
import React, { useEffect, useRef } from "react";
import { Animated } from "react-native";
import { colors } from "../theme";

export function LiveDot({ size = 6 }: { size?: number }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.live,
        opacity,
      }}
    />
  );
}
