import { useEffect, useMemo, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
} from "@expo-google-fonts/hanken-grotesk";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";

import { ThemeProvider, useTheme } from "../src/theme/theme-provider";
import { createQueryClient } from "../src/lib/query/client";
import { persistOptions } from "../src/lib/query/persist";
import { installOnlineManager } from "../src/lib/query/online-manager";
import { initTokenStore } from "../src/lib/auth/token-store";

// Keep the native splash up until fonts and the session token are ready, so
// the first frame is the real UI rather than an unstyled flash.
void SplashScreen.preventAutoHideAsync();

// Connectivity detection is installed at module scope, not in an effect: it
// must be in place before the first query runs, and it is process-global
// rather than component state.
installOnlineManager();

function RootNavigator() {
  const { colors, scheme } = useTheme();

  return (
    <>
      {/* Contrast is chosen against the SURFACE, not the scheme name: in
          light mode the header is Paper (needs dark icons), in dark mode it
          is near-black (needs light ones). */}
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </>
  );
}

export default function RootLayout() {
  // One client instance for the app's lifetime. Recreating it on re-render
  // would drop the cache — which on this app means dropping the offline copy.
  const queryClient = useMemo(() => createQueryClient(), []);
  const [sessionReady, setSessionReady] = useState(false);

  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
  });

  useEffect(() => {
    // Hydrate the bearer token from the OS keychain and hand the API client
    // its provider. Must complete before the first authenticated request.
    initTokenStore().finally(() => setSessionReady(true));
  }, []);

  // A font that fails to load must not hold the splash forever — the app is
  // usable with system fonts, and a permanent splash is indistinguishable
  // from a crash. Proceed on error, having surfaced it.
  const ready = (fontsLoaded || Boolean(fontError)) && sessionReady;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
    >
      <ThemeProvider>
        <RootNavigator />
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
