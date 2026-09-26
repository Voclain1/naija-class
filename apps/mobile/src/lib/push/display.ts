import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// How an arriving notification is SHOWN. Found missing on a device
// (2026-09-25): registration, delivery and tap-routing were all built and
// tested, and nothing anywhere decided what happens when one actually lands.
//
// Two gaps, both invisible to a test and both silent in production:
//
//  1. NO FOREGROUND HANDLER. expo-notifications shows nothing while the app
//     is open unless `setNotificationHandler` says to. A teacher reading the
//     register when the 9am reminder fires would see nothing at all, and the
//     notification would look lost rather than suppressed.
//
//  2. NO ANDROID CHANNEL. Android 8+ files every notification into a channel,
//     and a channel's importance — not the payload — decides whether it makes
//     a sound or appears as a heads-up banner. With no channel declared, ours
//     land in a fallback of the OS's choosing, which is how "it was delivered
//     but nobody noticed" happens.
//
// Both are set once, at startup, before any notification can arrive.

/** The one channel. Named for what a school sees, not for our code. */
export const ANDROID_CHANNEL_ID = "school-kit";

/**
 * Called once from the root layout.
 *
 * Deliberately NOT called from `registerForPush`: display is about this
 * device, registration is about a signed-in principal, and a notification can
 * arrive for a principal who signed in on a previous launch.
 */
export async function initNotificationDisplay(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      // Show it even with the app open. Everything this app sends is
      // school-day business — a reminder, an announcement, a payment — and
      // none of it is worth hiding because someone happens to be looking at
      // another screen.
      shouldShowBanner: true,
      shouldShowList: true,
      // Sound and badge stay off in the foreground: the person is already
      // holding the phone, and a noise for something they can see is just
      // noise. The OS still sounds it when the app is in the background,
      // which is where it matters.
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS !== "android") return;

  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "School messages",
      description: "Announcements, reminders and payment alerts from your school.",
      // HIGH, not MAX: a heads-up banner with a sound, which is what "the
      // gate is closed tomorrow" needs — but not the full-screen treatment
      // Android reserves for alarms and calls. Nothing this app sends is an
      // alarm, and a school that is woken like one stops trusting the app.
      importance: Notifications.AndroidImportance.HIGH,
      // PUBLIC is safe here only because of N3: the server builds every
      // payload so the title is the school's name and the body says what
      // happened — never whose child, never how much. If that ever changes,
      // this line has to change with it.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: "default",
      enableVibrate: true,
    });
  } catch {
    // A channel that cannot be created must not stop the app from starting.
    // Notifications then fall back to the OS default channel — quieter than
    // intended, but still delivered.
  }
}
