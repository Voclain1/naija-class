# Complete report-card review

6 November 2026, fictional school/pupil data only. No live student records.

- [Free standard example](free-example.pdf), [preview](free-example.png): actual
  production HTML template rendered by Chromium with the worker's A4/margin
  settings. Twelve subjects, configured component maxima, standard development
  observations, grading key and signatory spaces; one page.
- [Paid classic example](paid-classic.png): the same data with serif type, navy
  colour, watermark and an additional school field. Standard and Compact were
  also rendered; each fits this normal sample on one A4 page.
- [Staff desktop](staff-desktop.png) / [phone](staff-phone.png): actual Next
  detail screen; [design settings desktop](settings-desktop.png) /
  [phone](settings-phone.png): actual Next settings screen. Desktop 1440px,
  phone 390px. API responses are fictional Playwright fixtures, never a
  production sign-in or data write. No fixture route is committed/shipped.

Browser interaction also verified that changing an observation and a school
field submits the expected PATCH. The document has no horizontal phone overflow;
the existing marks table retains its own horizontal scroll. These are responsive
web screenshots, not iOS/Android device evidence. Native entry and family display
changes pass TypeScript/lint and existing native unit tests, but require the
normal device smoke check before a mobile release.

A stress render with 36 subjects and deliberately long comments continues across
four pages, preserving text and repeated table headings. Extra/custom content can
use more than one page; nothing is scaled down until unreadable to force a fit.
Existing PDFs remain frozen until explicitly regenerated through existing gates.

Database/API integration cases and the new complete-report-card Playwright case
are committed but need CI's disposable Postgres/Redis. They were not run locally.

## Revised masthead

The Free example now includes a fictional Harmony Academy demonstration crest,
a prominent 64px logo and a centred, extra-bold 26px school name. Real cards use
the school's uploaded logo. Both this normal name and a deliberately long
nursery/primary/secondary school name were rendered and verified to fit the
12-subject sample on one A4 page, with the footer and all report sections intact.
The older paid-classic capture above predates this masthead refinement.
