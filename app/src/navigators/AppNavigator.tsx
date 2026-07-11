// Squawk navigation: five-tab bar (Home, Explore, [mic], Activity, Profile)
// per docs/plan.md §8, plus the Channel screen with its own in-screen header.
import React from "react";
import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { colors } from "../theme";
import { DiscoverScreen } from "../screens/DiscoverScreen";
import { ChannelScreen } from "../screens/ChannelScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { makePlaceholder } from "../screens/PlaceholderScreen";
import { BottomTabBar } from "../components/BottomTabBar";

export type RootStackParamList = {
  Tabs: undefined;
  Channel: { channelPk: string };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

const ExploreScreen = makePlaceholder("Explore", "compass");
const ActivityScreen = makePlaceholder("Activity", "bar-chart-2");

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
      <Tab.Screen name="Activity" component={ActivityScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator>
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen
          name="Channel"
          component={ChannelScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
