// Opening splash — the walkie-talkie chick animation (webm via expo-video),
// then the Bungee "SQUAWK" wordmark stamps in below the bird with its hard
// orange offset shadow and a tiny overshoot, holds, and the overlay fades to
// reveal the app. The wordmark animation uses the RN Animated API (same as
// PTTButton / LiveDot); no reanimated dependency. Auto-dismisses via onFinish.
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { colors, fonts } from "../theme";

const SPLASH_VIDEO = require("../assets/squawk_splash.webm");

type Props = { onFinish: () => void };

export function SplashScreen({ onFinish }: Props) {
  const stampScale = useRef(new Animated.Value(0.4)).current;
  const stampOpacity = useRef(new Animated.Value(0)).current;
  const stampTranslate = useRef(new Animated.Value(-10)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const stampedRef = useRef(false);

  const player = useVideoPlayer(SPLASH_VIDEO, (p) => {
    p.loop = false;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    // Stamp the wordmark in once the bird animation finishes (video holds on
    // its last frame). A fallback timer covers a slow/failed video load so the
    // splash never hangs.
    const stamp = () => {
      if (stampedRef.current) return;
      stampedRef.current = true;
      Animated.parallel([
        Animated.timing(stampOpacity, {
          toValue: 1,
          duration: 110,
          useNativeDriver: true,
        }),
        // spring with low friction → snaps in past 1.0 and settles (overshoot)
        Animated.spring(stampScale, {
          toValue: 1,
          friction: 5,
          tension: 170,
          useNativeDriver: true,
        }),
        Animated.spring(stampTranslate, {
          toValue: 0,
          friction: 5,
          tension: 170,
          useNativeDriver: true,
        }),
      ]).start(() => {
        Animated.sequence([
          Animated.delay(950),
          Animated.timing(overlayOpacity, {
            toValue: 0,
            duration: 420,
            useNativeDriver: true,
          }),
        ]).start(() => onFinish());
      });
    };

    const sub = player.addListener("playToEnd", stamp);
    const fallback = setTimeout(stamp, 4200);
    return () => {
      sub.remove();
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[styles.overlay, { opacity: overlayOpacity }]}
      pointerEvents="none"
    >
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="cover"
        nativeControls={false}
      />
      <Animated.View
        style={[
          styles.stampWrap,
          {
            opacity: stampOpacity,
            transform: [{ scale: stampScale }, { translateY: stampTranslate }],
          },
        ]}
      >
        {/* hard orange offset shadow = an orange copy stacked behind the
            white one (crisper + more reliable on Android than textShadow) */}
        <View>
          <Animated.Text style={[styles.wordmark, styles.wordmarkShadow]}>
            SQUAWK
          </Animated.Text>
          <Animated.Text style={styles.wordmark}>SQUAWK</Animated.Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000", // matches the video's black; no seam under cover
    zIndex: 100,
  },
  stampWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: "22%", // in the empty space below the bird
    alignItems: "center",
  },
  wordmark: {
    fontFamily: fonts.wordmark,
    fontSize: 54,
    color: colors.text,
  },
  wordmarkShadow: {
    position: "absolute",
    left: 5,
    top: 5, // hard offset down-right
    color: colors.accent, // #FF6B2C
  },
});
