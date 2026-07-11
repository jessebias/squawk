// Five-tab bottom nav with the raised center gradient mic — docs/plan.md §8.
// Active tab icon + label render through a gradient mask (ALOT reference).
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { colors, gradient, hairline } from "../theme";

const ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  Home: "home",
  Explore: "compass",
  Leaderboard: "bar-chart-2",
  Profile: "user",
};

function TabContent({ routeName, focused }: { routeName: string; focused: boolean }) {
  return (
    <View style={styles.tabInner}>
      <Feather
        name={ICONS[routeName]}
        size={18}
        color={focused ? "#FFFFFF" : colors.textMuted}
      />
      <Text style={[styles.label, focused && styles.labelOn]}>{routeName}</Text>
    </View>
  );
}

export function BottomTabBar({ state, navigation }: BottomTabBarProps) {
  const tab = (routeName: string, index: number) => {
    const focused = state.index === index;
    return (
      <Pressable
        key={routeName}
        style={styles.tab}
        onPress={() => navigation.navigate(routeName)}
      >
        {focused ? (
          <MaskedView
            maskElement={<TabContent routeName={routeName} focused />}
          >
            <LinearGradient
              colors={[...gradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
            >
              <View style={{ opacity: 0 }}>
                <TabContent routeName={routeName} focused />
              </View>
            </LinearGradient>
          </MaskedView>
        ) : (
          <TabContent routeName={routeName} focused={false} />
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.bar}>
      {tab("Home", 0)}
      {tab("Explore", 1)}
      <View style={styles.tab}>
        <Pressable onPress={() => navigation.navigate("Home")} style={styles.micWrap}>
          <LinearGradient
            colors={[...gradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.mic}
          >
            <Feather name="mic" size={20} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>
      </View>
      {tab("Leaderboard", 2)}
      {tab("Profile", 3)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: colors.background,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    paddingTop: 8,
    paddingBottom: 14,
  },
  tab: { flex: 1, alignItems: "center" },
  tabInner: { alignItems: "center", gap: 3 },
  label: { fontSize: 10, color: colors.textMuted },
  labelOn: { color: "#FFFFFF", fontWeight: "600" },
  micWrap: {
    marginTop: -26,
    borderRadius: 26,
    shadowColor: colors.accent,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 10,
  },
  mic: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: colors.background,
  },
});
