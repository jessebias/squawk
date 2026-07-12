// Squawk navigation: five-tab bar (Home, Explore, [mic], Activity, Profile)
// per docs/plan.md §8, plus the Channel screen with its own in-screen header.
import React from "react";
import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { colors } from "../theme";
import { DiscoverScreen } from "../screens/DiscoverScreen";
import { ChannelScreen } from "../screens/ChannelScreen";
import { CreateChannelScreen } from "../screens/CreateChannelScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { LeaderboardScreen } from "../screens/LeaderboardScreen";
import { makePlaceholder } from "../screens/PlaceholderScreen";
import { BottomTabBar } from "../components/BottomTabBar";

export type RootStackParamList = {
  Tabs: undefined;
  Channel: { channelPk: string };
  CreateChannel: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

const ExploreScreen = makePlaceholder("Explore", "compass");

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.background,
    border: colors.border,
    text: colors.text,
    primary: colors.accent,
  },
};

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <BottomTabBar {...props} />}
    >
      <Tab.Screen name="Home" component={DiscoverScreen} />
      <Tab.Screen name="Explore" component={ExploreScreen} />
      <Tab.Screen name="Leaderboard" component={LeaderboardScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// Deep links: squawk://channel/<pubkey> — how unlisted private channels are
// shared (scheme registered in app.json).
const linking = {
  prefixes: ["squawk://"],
  config: {
    screens: {
      Channel: "channel/:channelPk",
    },
  },
};

export function AppNavigator() {
  return (
    <NavigationContainer theme={navTheme} linking={linking}>
      <Stack.Navigator>
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen
          name="Channel"
          component={ChannelScreen}
          // distinct screen per channel — without this, deep-linking to a
          // second channel while one is open silently no-ops
          getId={({ params }) => params.channelPk}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="CreateChannel"
          component={CreateChannelScreen}
          options={{
            headerShown: false,
            presentation: "modal",
            animation: "slide_from_bottom",
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
