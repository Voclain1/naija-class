"use client";

import { useEffect } from "react";

// Registers public/sw.js, which keeps the app's own files so a lab machine can
// open the exam with the network down once it has been opened online (D9).
// Production only: in development it would cache code being edited.
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
