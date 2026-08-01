import { Loader2 } from "lucide-react";

import { SchoolKitIcon } from "@/components/brand/schoolkit-mark";

// The brand mark itself — real icon graphic (2026-08-01), replacing the
// pulsing text wordmark this used before any brand asset existed. Pulses
// gently while loading, same as the old text version. SchoolKitIcon already
// picks the light/dark-appropriate badge variant via its own dark: swap, so
// this component doesn't need to know which theme it's in.
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <div className="flex flex-col items-center gap-3" data-testid="brand-preloader">
      <div className="animate-pulse">
        <SchoolKitIcon size={size} />
      </div>
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
      <BrandMark size={48} />
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
      <BrandMark size={32} />
    </div>
  );
}
