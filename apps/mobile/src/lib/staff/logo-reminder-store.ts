import AsyncStorage from "@react-native-async-storage/async-storage";

import { countSitting, dismiss, parseRecord, shouldRemind, type ReminderRecord } from "./logo-reminder";

// Where the logo reminder's record is kept: AsyncStorage, one per school. A
// per-device convenience, like the theme (theme/preference-store.ts), so it
// is not swept on sign-out. Every failure degrades to "show the reminder".

const key = (schoolId: string) => `sk_logo_reminder:${schoolId}`;

// Schools already counted in this run of the app, so opening the home screen
// again is not a new sitting.
const countedThisRun = new Set<string>();

async function read(schoolId: string): Promise<ReminderRecord> {
  try {
    return parseRecord(await AsyncStorage.getItem(key(schoolId)));
  } catch {
    return parseRecord(null);
  }
}

async function write(schoolId: string, record: ReminderRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(key(schoolId), JSON.stringify(record));
  } catch {
    // Nowhere to remember it: the reminder just comes back next time.
  }
}

/** Counts this sitting (once per run) and says whether to show the reminder. */
export async function noteSittingAndCheck(schoolId: string): Promise<boolean> {
  let record = await read(schoolId);
  if (!countedThisRun.has(schoolId)) {
    countedThisRun.add(schoolId);
    record = countSitting(record);
    await write(schoolId, record);
  }
  return shouldRemind(record);
}

export async function dismissLogoReminder(schoolId: string): Promise<void> {
  await write(schoolId, dismiss(await read(schoolId)));
}
