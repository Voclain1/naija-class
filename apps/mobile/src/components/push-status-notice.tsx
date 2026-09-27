import { useEffect, useState } from "react";

import { describePushStatus, type PushStatus } from "../lib/push/push-eligibility";
import { getPushStatus } from "../lib/push/register";
import { Notice } from "./ui";

// Says, on the screen, when this phone will not receive notifications.
//
// Three separate faults — permission never asked on Android 13+, registration
// never called on a restored session, and the token request throwing — all
// presented to a person as the same thing: silence. Each took a round of
// guessing and a new build to tell apart.
//
// This renders NOTHING when registration worked, which is almost always. It is
// not a status widget; it is the one line that turns "notifications don't work"
// into a report someone can act on.

export function PushStatusNotice() {
  const [status, setStatus] = useState<PushStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPushStatus().then(({ status: next }) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const message = describePushStatus(status);
  if (message === null) return null;
  return <Notice tone="warning">{message}</Notice>;
}
