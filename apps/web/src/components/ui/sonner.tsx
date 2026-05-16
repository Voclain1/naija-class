"use client";

import { Toaster as SonnerToaster } from "sonner";

// Bottom-right placement: the admin shell's profile dropdown sits in the
// top-right corner, and Sonner's default top-right position collides with
// the dropdown's open panel. Bottom-right keeps toasts visible without
// overlapping the menu.
export function Toaster() {
  return <SonnerToaster position="bottom-right" richColors closeButton />;
}
