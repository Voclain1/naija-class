import Image from "next/image";

// The SchoolKit lockup for the portal's sign-in pages: icon plus the
// "school·kit" wordmark, the same treatment apps/web's auth layout has used
// since the brand assets landed (2026-08-01). Until 2026-10-02 these pages
// said "SchoolKit" in plain bold sans, so a parent's first screen was the one
// place the product had no logo.
//
// A copy of apps/web/src/components/brand/schoolkit-mark.tsx rather than a
// share through packages/ui, deliberately: that one is built on next/image,
// which belongs to each Next app, and packages/ui has no Next dependency. The
// light icon only — the portal has no dark mode. The PNG lives in this app's
// own public/brand, copied from apps/web's.
//
// The visible lockup is aria-hidden and the heading carries "SchoolKit" for
// assistive tech: "school" + "kit" in two spans would otherwise be read as one
// lower-case word, and terminology-presentation.spec.ts finds this heading by
// that name.
export function BrandHeading({ tagline = "Parent Portal" }: { tagline?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <h1>
        <span className="sr-only">SchoolKit</span>
        <span aria-hidden className="inline-flex items-center gap-2">
          <Image src="/brand/schoolkit-icon.png" alt="" width={40} height={40} priority />
          <span className="font-sans text-2xl font-semibold tracking-tight">
            <span className="text-foreground">school</span>
            <span className="text-brandAccent">kit</span>
          </span>
        </span>
      </h1>
      <p className="text-sm text-muted-foreground">{tagline}</p>
    </div>
  );
}
