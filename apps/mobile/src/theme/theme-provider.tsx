import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { colors, type ColorScheme, type ThemeColors } from "./tokens";

// Mobile's equivalent of next-themes on web. Deliberately thinner: it follows
// the OS setting only, with no in-app light/dark toggle and no persistence.
//
// Web needs a toggle because a browser tab has no reliable OS signal for a
// user who wants dark mode on one site and not another. A phone does — the
// OS-level setting IS the user's stated preference, and apps that add their
// own toggle on top mostly add a way to get out of sync with it. If a real
// need for an override appears, this is the one place it goes.

interface ThemeValue {
  scheme: ColorScheme;
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // useColorScheme returns null when the OS preference is unknown; treat that
  // as light rather than guessing dark.
  const scheme: ColorScheme = useColorScheme() === "dark" ? "dark" : "light";

  const value = useMemo<ThemeValue>(
    () => ({ scheme, colors: colors[scheme] }),
    [scheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return value;
}
