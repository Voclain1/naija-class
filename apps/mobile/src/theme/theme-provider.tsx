import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";

import { resolveScheme, type ThemePreference } from "./preference";
import { loadThemePreference, saveThemePreference } from "./preference-store";
import { colors, type ColorScheme, type ThemeColors } from "./tokens";

// Light, dark, or whatever the phone says (docs/modules/look-and-feel.md
// Part 3).
//
// This used to follow the OS only, on the reasoning that a phone's setting IS
// the user's stated preference and an in-app toggle is mostly a way to get out
// of sync with it. That reasoning still holds for the DEFAULT, which is why
// "system" is it — but not as the only option. People share handsets, read in
// bed with the phone on light, and sit in sunlight with it on dark; a school
// app that cannot be told otherwise is the one being stubborn.
//
// The decision and the storage live in ./preference so they can be tested;
// this file is the React seam.

interface ThemeValue {
  scheme: ColorScheme;
  colors: ThemeColors;
  /** What the person chose, which is not always what is rendering. */
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  // Starts as "system" — the same thing this provider did before there was a
  // choice — so the first frame is never wrong for anyone who has not set one.
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    let cancelled = false;
    void loadThemePreference().then((stored) => {
      if (!cancelled) setPreferenceState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    // Applied immediately, persisted in the background: a colour scheme that
    // waits on a disk write before changing feels broken.
    setPreferenceState(next);
    void saveThemePreference(next);
  }, []);

  const scheme = resolveScheme(preference, systemScheme);

  const value = useMemo<ThemeValue>(
    () => ({ scheme, colors: colors[scheme], preference, setPreference }),
    [scheme, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return value;
}
