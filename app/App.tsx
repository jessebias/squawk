// Polyfills first — required by @solana/web3.js and anchor in RN.
import "./src/polyfills";

import React, { useState } from "react";
import { StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts, Bungee_400Regular } from "@expo-google-fonts/bungee";
import { Orbitron_500Medium, Orbitron_700Bold } from "@expo-google-fonts/orbitron";
import { AppNavigator } from "./src/navigators/AppNavigator";
import { WalletProvider } from "./src/providers/WalletProvider";
import { SplashScreen } from "./src/components/SplashScreen";
import { colors } from "./src/theme";

const queryClient = new QueryClient();

export default function App() {
  const [fontsLoaded] = useFonts({
    Bungee_400Regular,
    Orbitron_500Medium,
    Orbitron_700Bold,
  });
  const [splashDone, setSplashDone] = useState(false);

  if (!fontsLoaded) {
    return <View style={styles.shell} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <View style={styles.shell}>
          <StatusBar barStyle="light-content" backgroundColor={colors.background} />
          <SafeAreaView style={styles.shell}>
            <AppNavigator />
          </SafeAreaView>
          {!splashDone && <SplashScreen onFinish={() => setSplashDone(true)} />}
        </View>
      </WalletProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.background },
});
