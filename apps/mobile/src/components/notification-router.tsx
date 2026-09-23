import { useEffect } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";

import { useSession } from "../lib/auth/session";
import { routeForNotification } from "../lib/push/routes";

// Tapping a notification opens the screen it was about.
//
// Renders nothing: it exists to hold two subscriptions in one place, inside
// the session provider so it knows WHO is signed in — the same "results"
// notification is a different screen for a parent, a student and a head.
//
// The cold-start case is the one that is easy to miss and the most common in
// practice: a phone in a pocket, a notification tapped hours later, the app
// not running at all. getLastNotificationResponseAsync covers it; the
// listener alone would leave that tap on the home screen.

export function NotificationRouter() {
  const router = useRouter();
  const { status, principal } = useSession();

  useEffect(() => {
    // Only route once there IS a surface to route to. While the session is
    // loading or locked, the tap is remembered by the OS and re-read below on
    // the next run of this effect.
    if (status !== "authenticated" || principal === null) return;

    let cancelled = false;

    const open = (response: Notifications.NotificationResponse | null) => {
      if (cancelled || !response) return;
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const path = routeForNotification(data, principal);
      if (path) router.push(path as never);
    };

    // A tap that launched the app from cold.
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);

    // Taps while the app is running or backgrounded.
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [principal, router, status]);

  return null;
}
