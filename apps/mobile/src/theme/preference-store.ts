import AsyncStorage from "@react-native-async-storage/async-storage";

import { parsePreference, type ThemePreference } from "./preference";

// Where the theme choice is kept. The platform seam, kept apart from the rule
// in ./preference so that file stays react-native-free and testable.
//
// D8 — stored PER INSTALL, not per account.
//
// AsyncStorage rather than the server or the user row. A shared family handset
// has one screen and possibly several accounts, and "this phone is dark" is a
// property of the phone, not of whoever is signed in. It also means the choice
// survives signing out, which is what people expect — a setting that resets on
// logout reads as the app forgetting.
//
// Deliberately NOT swept by the staff lock teardown either: that drops cached
// queries by the "staff" prefix, and a teacher handing their phone to a
// colleague should not hand over a suddenly-white screen.

const STORAGE_KEY = "sk_theme_preference";

export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    return parsePreference(await AsyncStorage.getItem(STORAGE_KEY));
  } catch {
    // A preference we cannot read is not worth failing a launch for.
    return "system";
  }
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // The choice still applies for this run; it just will not survive a
    // restart. Degrading quietly beats an error toast over a colour scheme.
  }
}
