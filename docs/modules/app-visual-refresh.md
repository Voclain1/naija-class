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
