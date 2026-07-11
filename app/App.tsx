// Polyfills first — required by @solana/web3.js and anchor in RN.
import "./src/polyfills";

import React from "react";
import { StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts, Bungee_400Regular } from "@expo-google-fonts/bungee";
import { AppNavigator } from "./src/navigators/AppNavigator";
import { colors } from "./src/theme";

const queryClient = new QueryClient();

export default function App() {
  const [fontsLoaded] = useFonts({ Bungee_400Regular });

  if (!fontsLoaded) {
    return <View style={styles.shell} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaView style={styles.shell}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <AppNavigator />
      </SafeAreaView>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.background },
});
