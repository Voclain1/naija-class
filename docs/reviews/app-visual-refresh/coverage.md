# Approved visual direction — app-wide coverage

Owner instruction, 19 October: carry the approved appearance through the full
app estate; keep Android/iOS restrained and close to the current app direction.

## Coverage mechanism

`packages/ui/src/surfaces.css` is imported **once by each web root layout**, with
`schoolkit-surface` on BODY. That reaches route groups, dynamically loaded
screens and portal-mounted dialogs. It covers both shared primitives and the
legacy inline headings, panels and native HTML form controls. Styling does not
depend on a screen having been converted to PageHeader first.

| Surface | Source route files | Treatment |
| --- | ---: | --- |
| Staff admin and operations | 116 | Approved rail, Paper canvas, bold gold-marked headings, white panels, consistent forms/tables/tabs/dialogs |
| Teacher web | 38 | Same presentation; existing teacher navigation and permission gates |
| Other staff web routes | 16 | Sign-in/recovery (4), onboarding (5), platform admin (3), help (1), invitations (1), root redirect (1), developer debug (1) |
| Parent portal | 23 | Shared light-theme typography, panels and controls; quiet school banner; entry-page branding |
| Exam app | 2 | Matching sans typography and white surfaces; plain exam controls, existing targets and exam behaviour |
| Expo Android/iOS | 99 screen/route files, excluding layouts | Existing shared theme/primitives carry through; this rollout only refines form leading and readable notices |

Counts are source inventories, **not claims that every route was manually
exercised**. Redirect-only routes render no product UI. The developer debug
route retains its simple diagnostics. The top-level web error boundary has a
self-contained matching palette so it can work when app CSS/fonts fail.

## Native restraint

The accepted home headers and school-summary tiles remain as approved. Working
screens keep their current layouts, actions, navigation, labels, iconography
and motion. No new illustrations, animated flourishes, replacement navigation
or decorative panels were added to native workflows in this rollout. The same
React Native components compile for Android and iOS; no platform-specific UX
was introduced.

## Deliberate document boundaries

The shared presentation is screen-only. Printed report/exam/receipt output,
physical ID-card dimensions, QR codes, photo-crop canvases and per-school brand
colours stay with their existing renderers. Semantic status colours and error
borders remain meaningful; form errors are not recoloured as neutral inputs.
The separate marketing-site repository is outside the main-app scope of the
original request.

## Verification

- Typechecks: web, portal, exam app, mobile and shared UI pass.
- Lint: web, portal, exam app and mobile pass.
- Existing suites: web 560, mobile 815, portal 4, exam app 14 — **1,393 tests**.
- Expo production exports: Android (Hermes), iOS (Hermes) and web pass.
- Browser review with synthetic request-intercepted data: roster, school
  settings, settings hub, academic years, invoices, report cards, teacher
  classes, staff sign-in; portal home/settings/sign-in and public result
  checker. Desktop and 390px renders show no page errors or horizontal overflow.
- The exam entry page also renders without page errors or mobile overflow.
- The academic-year dialog at 320px keeps its controls inside the viewport;
  paired date fields stack and Escape dismisses it. Long dialogs can scroll
  within the viewport.
- These captures use complete sample DTOs. Initial fixture failures from
  omitted plan/date fields were corrected in the local review harness, not by
  changing application logic.
- Android/iOS builds are **bundle verification, not device runtime evidence**.
  Device/simulator smoke and the full database/API-backed Playwright suite
  remain outstanding. Nothing was merged or deployed in this session.
