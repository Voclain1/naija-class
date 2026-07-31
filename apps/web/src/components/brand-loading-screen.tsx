import { Loader2 } from "lucide-react";

// The brand mark itself — same font-serif/font-medium treatment as the real
// sidebar wordmark (see admin/sidebar.tsx, teacher/sidebar.tsx: "font-serif
// text-lg font-medium") so the loading state reads as the same brand, not a
// generic spinner. Pulses gently while loading; this project has no separate
// icon/logo asset (no favicon, no SVG mark) — the wordmark IS the logo in
// this design system, so it's the loading indicator.
export function BrandMark({ size = "text-lg" }: { size?: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <p
        className={`animate-pulse font-serif ${size} font-medium tracking-tight text-foreground`}
      >
        School Kit
      </p>
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  );
}

// Full-viewport loading screen — for use BEFORE any persistent layout chrome
// exists (auth gates, the pre-login invitation-accept page). Unchanged call
// sites: require-auth.tsx, require-onboarding.tsx, invitations/[token]/page.tsx.
export function BrandLoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <BrandMark size="text-2xl" />
    </div>
  );
}

// Inline variant — for Next.js `loading.tsx` files nested INSIDE a layout
// that already renders persistent chrome (sidebar/topbar). A full min-h-screen
// wrapper here would double-count the viewport height under that chrome;
// this only fills the content slot the layout leaves for its children.
export function BrandLoadingInline() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
      <BrandMark size="text-lg" />
    </div>
  );
}
