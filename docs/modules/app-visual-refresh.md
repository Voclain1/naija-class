# App visual refresh — October 2026

## Scope

Owner request, 19 October: refresh the main web and mobile app UI, using the
supplied Yuyu screenshots as visual inspiration. **UI only.** Existing screen
structure, navigation, workflows, content, permissions, form semantics, API
calls, finance calculations and offline behaviour are outside this work.

The references contribute typographic confidence, clear surface separation,
soft backgrounds and restrained colour. They are marketing pages; their huge
headlines, purple palette, floating purchase banner and decorative 3D artwork
are not carried into a school administration app.

## Visual direction

- Keep SchoolKit's Paper canvas, Ink text, Deep Emerald actions, Bright Emerald
  dark-mode actions and Gold Spark accent.
- White light-mode cards and popovers distinguish content from the warm page.
  Muted surfaces and borders lean subtly green rather than muddy beige.
- Sans-serif headings and numerals replace the editorial serif treatment:
  DM Sans on staff web and portal; the already bundled Hanken Grotesk on native.
  Legacy display aliases are retained so inline headings receive the treatment
  without a risky rewrite of every screen.
- Solid emerald selected navigation, muted inactive links, matching sidebar
  and topbar brand rows. Menu groups, search, persistence and permissions stay
  as implemented.
- Slightly softer corners, restrained card/button elevation, tinted metric
  icons and quieter table headers. Existing responsive table stacking stays.
- Native cards become white on Paper, with a consistent 8/12/20-point corner
  scale, sans headings and readable body leading. Secondary controls use
  quiet card surfaces and neutral borders.
- Brief colour/shadow feedback only, respecting reduced motion. Existing page
  transitions and loading/saved-row animations stay as implemented.
- No accent borders. Status text and current state semantics stay intact.
- No new package, font package, icon system or illustration payload.

## Implementation boundary

Shared tokens/primitives are the main implementation seam. This deliberately
covers existing screens through the components they already compose, without
replacing their data-bound content with demo data. The parent portal receives
the light theme and shared primitives too, so it stays visually related.

Print rules and card-specific document rendering are not redesigned. No API,
database, auth, payment, routing, navigation model, business logic or event
handler changes belong in this work. Unused display font imports are removed;
the dependencies/lockfile are not changed.

## Research references

- Linear, “A calmer interface for a product in motion”:
  https://linear.app/now/behind-the-latest-design-refresh — restrained hierarchy,
  consistent surfaces and reduced visual noise.
- Carbon data-table specifications:
  https://www.carbondesignsystem.com/building-blocks/core/components/data-table/specifications
  — orderly tabular typography and alignment for data-heavy screens.

These inform visual restraint, not a change to SchoolKit's interaction design.

## Verification

Validation results and environment limitations are recorded in the session
journal. Native browser rendering is not evidence of an Android/iOS device
smoke. A production release remains separate from this review branch.

## Reference-led second pass (owner feedback, 19 October)

The owner found the first pass too close to the old app. The revision makes the
reference more visible: bold welcome typography, a flat gold marker highlight,
a soft illustrated welcome panel, mint/gold metric surfaces, larger rounded
cards, and a contrasting deep-emerald navigation rail. The original desktop
information order and all action destinations stay intact. On phones the same
four web metrics use a two-column visual grid, with complete amounts and
supporting lines retained.

Native home headers use the same featured treatment. The staff school summary
renders the same four facts as tiles; the existing text, callback conditions
and permissions are preserved. A decorative figure style separates the existing
leading number from its suffix, without calculating or changing any values.
The native sign-in heading also uses the marker treatment.

The SchoolDayArt SVG and the native geometric book shapes are noninteractive,
hidden from accessibility and require no downloads. This is flat code-native
artwork, not a screenshot or mock product content.

Mobile QA includes the actual responsive Next dashboard and an isolated Expo
component fixture. Staff sign-in is deliberately unavailable on Expo web because
it requires a native device lock (`canProtectStaffSession`); that safeguard is
unchanged. The fixture composes the same native header, StatRow and ActionTile
components using sample data, is exported locally, then removed from source.
It is a component preview, not a native device screenshot or an authentication
verification. No fixture route is shipped.

## App-wide rollout after direction approval

The owner approved the second-pass direction and requested it throughout the
site, while retaining the native app's current restraint. The shared screen
layer (`@school-kit/ui/surfaces.css`) now ships from both staff and parent root
layouts. It covers legacy headings and hand-written form/panel styles as well
as shared components. Tabs, dropdowns, dialogs, auth/onboarding entry surfaces
and the payment callback match. The exam app gets only matching typography,
white surfaces and control treatment. Physical document rendering stays separate.

Native refinement is intentionally small: consistent form text leading and
readable tinted notices. Existing home styling, workflows and navigation stay.
Full source coverage and verification boundaries are recorded in
`docs/reviews/app-visual-refresh/coverage.md`.

## Dashboard tiles smearing on phones (fixed 2026-10-24)

The owner's Android recording showed the dashboard's four tiles smearing over
one another and the welcome card while scrolling. Two changes:

- `MetricValue` refits a figure only when its box's width changes or the web
  font arrives. It used to watch its own text and box size too, so each fit
  could trigger the next.
- The route transition (`app/(admin)/template.tsx`, `(teacher)` too) is an
  opacity-only fade (`animate-route-fade`, `tailwind.config.ts`), no longer
  tailwindcss-animate's `animate-in fade-in`. That also animated a 3D
  transform, which put the whole page on one GPU layer as the data arrived;
  low-memory phones kept stale pieces of it. Same 150 ms, same look.

`e2e/tests/dashboard-mobile-metrics.spec.ts` now also fails if the figures keep
resizing after the page settles. The glitch itself is in the phone's GPU and
does not reproduce in desktop Chromium, so it is confirmed on the phone.
