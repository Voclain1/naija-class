# School Kit — Workflow

How we build: fast, well, and only what's needed. Read once; refer back.

This workflow is shaped by three commitments:

1. **Build fast** — small scopes, sharp tools, no ceremony for ceremony's sake
2. **Build well** — quality gates that block real failure modes, not theatre
3. **Build what's needed** — every feature traces to a real user need; defer the rest

When in doubt, optimise for the next paying school, not for engineering elegance.

---

## The four meta-rules

If everything else here is forgotten, these matter most:

1. **Spec before code.** Even 10 minutes of writing prevents hours of rework.
2. **One concern per session, prompt, commit, PR.** Scope creep is the #1 speed killer.
3. **Multi-tenancy isolation is sacred.** Test it on every build. A tenancy bug ends the business.
4. **If a feature has no customer behind it (past Phase 3), it doesn't ship.** Build for evidence, not imagination.

---

## Repo structure

```
school-kit/
├── CLAUDE.md             How code is written (rules, conventions)
├── WORKFLOW.md           This file
├── README.md             Public project summary
├── docs/
│   ├── ARCHITECTURE.md   System design
│   ├── DECISIONS.md      ADRs (for decisions you'd forget the reason for)
│   ├── deferred.md       Ideas to defer (prevents scope creep)
│   ├── journal/          Daily 2-min notes
│   ├── modules/          One spec per module/phase
│   └── runbooks/         Deploy, rollback, incident
├── apps/                 web, mobile, api
├── packages/             db, types, ui, ai, config
├── infra/                Terraform / Pulumi
└── .github/workflows/    CI/CD
```

## Branches and commits

- `main` — production. Auto-deploys live. No direct commits.
- `staging` — pre-production. Auto-deploys to staging. Merge here first.
- Feature branches: `phase-X/<module>` or `fix/<short>`. One per feature. Squash on merge.

Commits use conventional format: `feat(<module>): <what>`, `fix(<module>): <what>`, `refactor(...)`, `test(...)`, `docs(...)`, `chore(...)`. Lets changelogs write themselves.

---

## The daily shape

### Start of day (10 min)

1. `git pull` on `main` and your branch.
2. Open today's journal: `docs/journal/YYYY-MM-DD.md`. Template:
   ```markdown
   # YYYY-MM-DD
   ## Today's outcome
   <one concrete thing>
   ## Decisions
   ## Stuck on
   ## Tomorrow's first task
   ```
3. Re-read the active `docs/modules/<module>.md`. Re-orient.
4. Write today's one outcome. Not a list. One.

### Working with Claude Code

A productive session has a fixed shape:

1. **Context first.** First prompt of any session points at a spec:
   > Read docs/modules/phase-1.md section 3. Read packages/db/prisma/schema.prisma to see current state. Don't write code yet. Summarize what you'll build and which files you'll touch.

2. **Wait for the plan.** Correct any misreads before code is written.

3. **Narrow scope per prompt.** Not "implement enrollment." Single concern: "Implement POST /enrollments. Service spec first, then implementation."

4. **Test as you go.** After each step: *"Run the tests. Show me the output."* No silent success.

5. **Commit when green.** Conventional message. Don't batch.

6. **End the session cleanly.** When today's outcome is done, *stop*. Don't drift into "while we're here..."

### End of day (5 min)

- Everything committed and pushed
- Tests green (or noted in journal if not)
- Journal updated with tomorrow's first task

### Realistic time budget

Solo founders underestimate non-coding work. Plan for it:

| Activity | Hours |
|---|---|
| Coding | 4–5 |
| Testing (manual + writing tests) | 1–1.5 |
| Docs (spec, journal, README) | 0.5 |
| Code review of Claude Code's output | 0.5 |
| Admin, customer messages | 0.5 |
| Buffer | 1 |

That's an honest 7–9 hour day. Calendar-block it.

---

## Module lifecycle — four stages

Each stage has one job. Don't add stages until they earn their place.

### Stage 1 — Spec (1–2 hours)

Before any code, write `docs/modules/<module>.md`. Always start with the scope-cut question:

> **What's the minimum version of this that a school could use? What's tempting to add that isn't actually needed for that?**

Whatever's tempting but not needed goes in `docs/deferred.md`. The spec itself stays minimal.

Spec template:

```markdown
# Module: <Name>

## Purpose
One paragraph: what problem, for whom.

## Minimum to ship
The narrowest version that works.

## Out of scope (in deferred.md)
What we're explicitly NOT building now.

## Data model
Prisma models added or changed.

## API endpoints
Method, path, auth, input shape, output shape, errors.

## UI screens
Route, role, key states, key interactions.

## Acceptance criteria
Numbered list. Concrete. Testable.

## Risks
What could go wrong. What I learned from similar modules.
```

### Stage 2 — Build (the work)

Implement in small testable units, in this order:
1. Pure functions (calculations, validators) — easy to test
2. Service layer with mocked DB
3. Controller with mocked service
4. Background jobs (if any)
5. UI components

For each unit: test first, implementation second, run tests, commit. Conventional commit messages throughout.

### Stage 3 — Review (30–60 min)

You're solo, so "code review" means *you* reviewing Claude Code's diff with fresh eyes:

1. Walk away for 15 minutes. Coffee, walk, anything that resets focus.
2. Read the full diff in VS Code's Source Control panel.
3. Run the **review checklist**:
   - [ ] Every query uses `withTenant` or includes `school_id` explicitly
   - [ ] No `Float`/`Number` on money fields — kobo as `Int`/`bigint` only
   - [ ] Every mutation logs to `audit_logs`
   - [ ] No hardcoded IDs, emails, or test data in production paths
   - [ ] Error messages safe (no stack traces, no secrets)
   - [ ] At least one test for the unhappy path
   - [ ] New permissions added to `packages/types/src/permissions.ts`
   - [ ] `.env.example` updated if new env vars
4. Run the app. Test the happy path manually once.

Fail any item → fix before merging. No "I'll clean it up later."

### Stage 4 — Ship

1. PR title: `feat(<module>): <one-line summary>`
2. PR body: 2–3 sentences on what and how to test. That's it.
3. CI must pass.
4. Squash merge to `staging`. Delete the branch.
5. Verify on staging for 24h (longer if it touches money or auth).
6. Merge `staging` → `main`. Tag: `v0.X.Y`.
7. Watch Sentry + PostHog for 48 hours post-prod.

If anything spikes: roll back. Procedure in `docs/runbooks/rollback.md` (write it before you need it).

---

## Quality gates

Five things that *block* progress when they fail. Non-negotiable.

### 1. Pre-commit hooks (local)
Husky runs lint + typecheck on every commit. Failures block the commit.
Setup: `pnpm dlx husky-init && pnpm install`.

### 2. CI on every PR
GitHub Actions runs: install, lint, typecheck, test, build, Prisma migration dry-run. Failures block merge.

### 3. The RLS test
A dedicated test that creates two schools with data, queries as School A, asserts School B is invisible. Runs in CI on every build. **If this test ever breaks, everything stops until it's fixed.** A tenancy bug is the only bug that can end your business overnight.

### 4. AI eval suite (from Phase 5)
For any change to a prompt in `packages/ai/prompts/`, run `pnpm ai:eval` against the golden set. Regression below threshold = PR fails.

### 5. Production smoke test
After every prod deploy, an automated test hits live: signup, login, one critical flow. Failure → auto-rollback + alert.

---

## Tests — just what's needed

Two test types are mandatory; the third is selective:

| Type | When | Tool |
|---|---|---|
| **Unit** | Always, on services with business logic | Vitest |
| **E2E happy path** | Always, one per module | Playwright |
| **Integration** | Only where the integration *is* the risk (RLS, payments, AI calls) | Vitest + test DB |

Don't over-test. A passing E2E happy-path is worth more than 50 unit tests on a getter.

---

## Rules that never flex

These can't be bypassed regardless of urgency, deadline, or customer pressure. Breaking any of these is permanent damage:

1. **Multi-tenancy isolation** — `withTenant` always, every query, every endpoint.
2. **Money in integer kobo** — never floats, never decimals in JS.
3. **AI never auto-finalises** — grades, comments, behaviour records always need teacher approval.
4. **No secrets in commits** — `.env` in `.gitignore` from commit zero. API keys never in code.
5. **Rollback works before deploy** — write the runbook before you need it.

Everything else can flex under pressure. These cannot.

---

## Operating rhythms

Cadences that keep the project healthy beyond daily work.

### Weekly review (30 min, Sunday or Monday)

1. What shipped this week? (look at merged PRs)
2. One concrete outcome for next week — write it
3. Any noisy errors in Sentry being ignored? File an issue
4. Any decisions you've been avoiding? Force one
5. Update README "current status" line

### Customer conversations

**Pre-MVP (now → end of Phase 3):** 3 school-owner conversations *total* before launch. Validate, don't survey. Capture in `docs/customer-conversations/YYYY-MM-DD-<school>.md`.

**Post-launch (Phase 3+):** Weekly. Every feature past this point must trace to a specific school's specific ask. No "I think they'd want this."

### When to write an ADR

Only for decisions you'd struggle to reconstruct in 6 months. Not every choice.

Examples that deserve ADRs:
- Picked Better Auth over Lucia
- RLS instead of schema-per-tenant
- Joburg region over Lagos hosting
- Paystack over Flutterwave

Examples that don't:
- File naming style (in CLAUDE.md instead)
- Specific UI component choices
- Sprint-level scope decisions

Template in `docs/DECISIONS.md`:

```markdown
## ADR-NNN: <Title>
Date: YYYY-MM-DD
Status: accepted

### Context
What problem, what forces.

### Decision
What we chose.

### Alternatives
What we didn't choose, briefly why.

### Consequences
What gets easier or harder.
```

### Deferred features

When you catch yourself thinking "while I'm here, I should also..." — stop. Open `docs/deferred.md` and add a line. Format:

```markdown
- [ ] <feature> — <why deferred> — <what would unblock it>
```

Example:
- [ ] Bulk SMS scheduling — not requested by any pilot school yet — wait for first customer ask
- [ ] Multi-currency support — Naira-only until pan-African expansion — defer until 1000 paying schools

Review this file at every weekly review. Move things back into modules only when a customer asks.

### When the architecture/strategy reviews start

Both deferred until they earn their place:

- **Monthly architecture review** — starts Phase 4, when there are multiple modules to keep coherent
- **Quarterly strategy review** — starts when revenue arrives. Before revenue, the strategy is "ship Phase X." After revenue, real strategy questions appear.

---

## Working with Claude Code — what actually works

### Session hygiene

- One module per session ideally
- Sessions longer than ~2 hours of active work → start fresh; drift is real
- First prompt of any session points at a spec. Never start cold.

### Prompt patterns that work

**Spec-grounded:**
> Read `docs/modules/<module>.md` section X. Implement the Y endpoint per the spec. Service spec first, then implementation. Don't touch the UI.

**Bug-fixing:**
> Test `<name>` is failing. Output: [paste]. Read the relevant code. Tell me what's wrong before changing anything.

**Refactor:**
> The `<function>` in `<file>` is hard to follow. Refactor for clarity. No behaviour change. Existing tests must pass.

**Review:**
> Review the diff on this branch. Use the checklist in WORKFLOW.md Stage 3. Flag anything that fails.

### Prompts that cause problems

- "Build the whole module" — too broad, drifts
- "Fix everything that's wrong" — destructive
- "Make it better" — vague scope creep
- "Just do what you think is best" — surrenders judgment

### When to push back

Push back when Claude Code:
- Suggests a shortcut that contradicts CLAUDE.md
- Generates code bypassing a quality gate
- Picks a library not in the stack list without explanation
- Writes vague tests
- "Fixes" code by deleting tests

Push back by quoting the rule. Be specific.

---

## What buys you speed (compounding)

These habits feel like overhead in week one and feel like superpowers by month three:

1. **Specs before code** — 1 hour of spec saves 1 day of rework
2. **Daily journal** — 2 minutes preserves 2 hours of context
3. **One concern per commit** — makes bisecting bugs trivial
4. **Conventional commits** — release notes write themselves
5. **The RLS test** — catches the only bug class that ends the business
6. **Scope-cut question at every module** — prevents 80% of feature bloat
7. **Deferred file** — catches good ideas without acting on them

Trust the process when it feels slow. The compounding is real.

---

## What earns its place later (not now)

Don't build these yet. Add them when they earn their place:

- ADRs for routine decisions — add when you forget *why* something was chosen
- Architecture reviews — add Phase 4
- Strategy reviews — add post-revenue
- Onboarding docs — add 90 days before hiring
- Detailed PR templates — add when first contributor joins
- Custom Slack/Discord bots, dashboards, etc — add when the manual version becomes painful

The principle: **add process when its absence causes pain, not before.**
