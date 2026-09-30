# Look and feel — the website catching up with the app, and a theme people choose

**Status:** approved 2026-09-28. Part 1's **visible** goal is met
(2026-09-30): no admin or teacher page is still in the stock shadcn draft
style, the three dead-end wizard states have a way out, and the import
wizards were done last as D3 said. Typography replaced and, more to the
point, FIXED — see the last section. **Part 3 (the theme switcher) shipped**
2026-09-29. Part 2 (motion) not started; `apps/portal` still waiting on D4.

**What Part 1 has NOT finished, stated plainly:** 57 pages still inline
`<h1 className="font-serif text-2xl font-medium tracking-tight
text-foreground">` rather than calling `PageHeader`. They render identically
— those are the exact classes the primitive emits — so this is invisible to a
reader and real to a maintainer: the next change to the page-title treatment
would have to be made 58 times. It is deliberately not being done as a blind
sed, because those 57 headers differ in what surrounds the `h1` (a subtitle,
a back link, a toolbar, sometimes all three), and a mechanical swap across
that variety is how a cosmetic pass introduces a layout bug. It converts a
page at a time, as each page is next touched for another reason.
**Asked for:** "the app looks 95% good, I'll still want more beautification and
dynamism, but the website still looks pale/stale, like a draft; it has to
match/outmatch the app in UI" — plus a light/dark switcher in the app.

## What is actually wrong with the website

Not what it looks like from the outside. The brand tokens landed: **63 of 88**
admin and teacher pages already use Fraunces and the emerald/Paper palette.

The difference is that the APP got a design pass and the website never did. CP8
gave `apps/mobile` a vocabulary — `ScreenHeader`, `SectionHeader`, `TileGrid`,
`ActionTile`, `StatRow`, `ListRow`, `EmptyState`, `Skeleton` — eight primitives
every screen composes from. The web's eight shared components are
feature-specific (`stat-card`, `wizard-stepper`, `progress-meter`), and
**59 pages hand-roll their own page header** with inline classes.

So the website is not unstyled. It is *correct colours on undesigned pages*,
each inventing its own spacing, density and hierarchy. That is precisely the
gap between "pale" and "looks like software", and it is why adding more colour
would not fix it.

The 25 pages still on stock shadcn make it worse than the average suggests,
because of WHICH ones they are: settings, report cards and every import wizard
— the screens a head teacher lives in.

---

## Part 1 — A vocabulary, not a restyle

### D1 — Build the primitives first, apply them second

The temptation is to open the worst-looking page and fix it. That produces 88
individually-improved pages that still do not agree with each other, which is
the state we are already in one page at a time.

So: build the web counterparts of the app's eight primitives first, then apply
them. One system applied 88 times, not 88 redesigns.

| Primitive | What it fixes |
|---|---|
| `PageHeader` | The 59 hand-rolled headers. Title, optional subtitle, actions slot. |
| `SectionHeader` | Sub-sections inside a page, currently ad-hoc `h2`s. |
| `DataTable` shell | Density, zebra, sticky header, and the same empty/loading states everywhere. |
| `EmptyState` | Today every page writes its own dashed box and its own sentence. |
| `PageSkeleton` | Loading is a bare "Loading…" on most pages; the app has had skeletons since CP8. |
| `StatRow` / `StatGrid` | KPI rows exist only on the dashboard, as bespoke markup. |
| `FilterBar` | A web need the phone does not have: search + filters + count, aligned. |
| `FormRow` | Label, control, hint, error — currently inline on every form. |

### D2 — Match the app's LANGUAGE, not its layout

A phone screen is one column, thumb-first, one job per screen. A desktop page
is dense, mouse-first, several jobs at once. Copying the app's layout to the
web would produce a stretched phone, which is its own kind of amateurish.

What transfers is the language: the same type scale, the same card treatment,
the same emerald-for-primary discipline, the same rule that an empty state says
what to do next. What does not transfer is one-column tile grids on a 1400px
screen.

### D3 — The order of application is who sees it most

1. **Students, Finance, Report Cards, Settings** — daily screens for the two
   roles who live on the web (owner/admin).
2. **Gradebook, Enrollments, Timetable, Reports, Insights.**
3. **The import wizards, last.** Four of them, one-off flows a school touches
   during onboarding and rarely again. They are the ugliest and the least
   valuable to fix, and doing them first is how this kind of work stalls.

**Done 2026-09-30, and the order paid off in an unexpected way.** Reaching the
wizards last meant reaching them after `WizardStepper` already existed — so
most of the twelve steps needed no edit at all. Two thirds of them were
already on the stepper; the Guardian wizard was the holdout, and making the
older `Wizard.Header` render the stepper internally covered its last two steps
without touching either file. Had the wizards gone first, twelve pages would
have been restyled by hand and then restyled again when the shared component
arrived — which is the concrete version of the stall D1 is about.

### D4 — The portal gets the same vocabulary, on a delay

`apps/portal` is a parent's web fallback and is plainer still. It shares the
tokens but not the components. It follows the same vocabulary once the admin
pages are done — not in parallel, because a parent who wants a good experience
has the app, and the admin surface is where a school's judgement of the product
is formed.

---

## Part 2 — Dynamism, which the app lacks too

Worth saying plainly: the app has almost no motion either. "95% good" and
"needs dynamism" are the same observation.

### D5 — Motion that explains, never motion that decorates

Three uses, and nothing else:

- **Skeleton → content**, so a page resolves rather than jumps.
- **Optimistic feedback on write** — a saved row settles, a withdrawn one fades
  before it leaves. The app already does the data part of this; neither surface
  shows it.
- **Page and tab transitions**, short enough to feel like response rather than
  animation (150–200ms).

No parallax, no entrance animations on lists, nothing that repeats on every
scroll. A school's admin uses these screens for hours; anything decorative
becomes irritating by the third day.

### D6 — Respect `prefers-reduced-motion`, and mean it

Every transition above is disabled by that query. This is not box-ticking: it is
one media query, and vestibular disorders are common enough that a school of
400 has several.

---

## Part 3 — A theme people choose

Today `ThemeProvider` reads `useColorScheme()` and nothing else: the app follows
the phone's setting, with no choice and no memory.

### D7 — Three options, not two

**System (default), Light, Dark.** A switcher that only toggles light/dark
takes away "follow my phone", which is what most people actually want and what
the app does today. System stays the default so nothing changes for anyone who
does not go looking.

### D8 — Stored per install, not per account

The preference lives in `AsyncStorage`, not on the server and not on the user
row. A shared family handset has one screen and possibly several accounts, and
"my phone is dark" is a property of the phone, not of who is signed in. It also
means the choice survives sign-out, which is the behaviour people expect.

### D9 — It lives in the menu, not a new Settings screen

The app menu already carries Account items (My profile, Open the website, Sign
out). Theme belongs there, as a three-way control. Building a Settings screen
for one preference is how apps grow a junk drawer.

### D10 — Read the dark palette before trusting it

`tokens.ts` has a dark scheme and the app has rendered it only when a tester's
phone happened to be dark. Every screen needs looking at in dark mode once, and
the receipt is the specific one to check: it is HTML rendered for print and
sharing, and a dark-mode receipt that prints dark is a real bug hiding behind a
preference nobody has exercised.

---

## What this plan deliberately excludes

- **The three unbuilt features** — AI Tutor, Assessments & Exams, Result
  Checker. Named here so they are not forgotten, sized in the questions below,
  and out of scope for a look-and-feel pass.
- **iOS.** A separate track, and mostly infrastructure rather than design. Worth
  knowing now: an EAS **simulator** build needs no Apple Developer account and
  can be run on an online simulator, so iOS can be seen and tested this week for
  nothing. A build that installs on a real iPhone, or TestFlight, needs the
  $99/yr account.
- **The Play Store listing**, which is packaging rather than UI.

## Tests

Visual work resists assertion, so the tests here are narrow and about rules
rather than appearance:

- Every primitive renders its empty and loading state without data (the states
  most often forgotten).
- `prefers-reduced-motion` disables transitions (assert the class/style, not the
  animation).
- The theme preference persists, and an unset preference resolves to system.
- No page keeps a hand-rolled `font-serif text-2xl` header once its section is
  done — a grep-based conformance spec, in the spirit of
  `rbac-two-gate-conformance`.

## Open questions

1. **Order** — D3 puts the import wizards last. Agreed, or is onboarding the
   first thing a new school sees and therefore first?
2. **Scope of the first pass** — the whole vocabulary plus tier 1 (four page
   groups) is a substantial piece of work. Would you rather see the vocabulary
   plus ONE page group first, to judge the direction before it is applied
   widely?
3. **The three features** — which matters most? My read: **Result Checker** is
   the smallest and most visible to parents (it is a read of data that already
   exists); **Assessments & Exams** is medium and overlaps the gradebook;
   **AI Tutor** is the largest and is still blocked on the embeddings-vendor
   decision that Phase 7 never made.
4. **iOS** — shall I add a simulator profile and produce a build this week, so
   you can see it before deciding on the Apple account?

## The typeface was never rendering (found 2026-09-29)

While comparing candidate typefaces, the comparison turned out to be
meaningless: **app.schoolkit.ng was rendering in Times New Roman, in
production**, and had been for as long as the project has had a brand
typeface.

```
app.schoolkit.ng  ->  bodyFont: "Times New Roman"
                      --font-sans: (empty)
```

`globals.css` declared `--font-sans: var(--font-dm-sans)` on `:root`, while
`next/font` defines that variable through a class it puts on `<body>`. At
`:root` the variable does not exist, so the token resolved to EMPTY — and
`font-family: , ui-sans-serif, ...` is a parse error, so the browser discarded
the whole declaration, fallback list included, and used its default serif.

**Why it survived so long.** Everything checkable without a browser was
correct: the fonts downloaded, the `@font-face` rules shipped, the tokens were
in the stylesheet, `next/font` put its classes on `<body>`, and typecheck, lint
and 379 unit tests passed. The pages rendered. Only `getComputedStyle` in a
real browser disagreed.

**The instinct beat the diagnosis.** The request was "the website looks
pale/stale, like a draft — change the font". The font was not wrong; there was
no font. Every screenshot taken that evening, including the one labelled
CURRENT in a five-way comparison, was Times New Roman impersonating the brand.
It also explains the gap that prompted this plan in the first place: the app
sets its typefaces directly, with no variable indirection to break.

**Three changes:**

1. Tokens moved from `:root` to `body`, the scope the `next/font` class lives
   in.
2. Tailwind uses `var(--font-sans, ui-sans-serif)`. The in-var fallback is
   load-bearing rather than defensive dressing: an empty bare `var()` takes the
   whole declaration down with it, which is precisely how a missing token
   became Times rather than the system sans sitting right there in the list.
3. `e2e/tests/typography.spec.ts` asserts the COMPUTED font, names Times New
   Roman explicitly as the failure to catch, and checks the token is non-empty
   where the class lives. Asserting the stylesheet would have passed throughout
   the bug.

The typeface itself also changed in the same pass: **DM Serif Display + DM
Sans**, replacing Fraunces + Hanken Grotesk. Fraunces is a soft, wonky serif —
characterful on a marketing page, slightly unserious above a table of a
school's children. DM Serif Display is squarer and heavier, so a heading reads
as authority rather than personality, and the two were drawn as one family. The
portal, which had no typeface configured at all, now uses the same pair.
