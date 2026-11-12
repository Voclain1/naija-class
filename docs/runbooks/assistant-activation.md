# SchoolKit Assistant: activation, verification, kill and rollback

For the platform admin (Super Admin). Written 2026-11-11.
Design and rules: `docs/modules/assistant-workspace.md`, "Controlled
activation". Acceptance matrix for the pilot school:
`docs/reviews/virgo-assistant-same-day-e2e-runbook.md`. Legal and provider
gates: `docs/reviews/virgo-assistant-pilot-signoff-register.md`.

## What you control, and what you do not

- Only a platform admin can switch the Assistant on or off for a school. A
  school's owner cannot. Nothing is on by default, for old or new schools.
- There are six switches per school. Five involve no AI provider. The sixth,
  **AI understanding**, sends what staff type to the AI provider and is
  **refused in production** until the owner's decision AO-1 is recorded in
  code. You cannot switch it on before then: the console will say so.
- The switches never give a member of staff anything their own permissions
  do not. Every invoice run, reminder campaign, intake and correction still
  needs a person's approval on the server's preview.

## Where

Super-admin console → **Schools** → **Manage** on the school's row →
**SchoolKit Assistant**.

Each row shows two badges:

- **Switch on / Switch off**: what is stored for this school.
- **Working / Not working**: whether staff with the right permissions can
  use it now. Under "Not working" every reason is listed in words.

Read "Working", not "Switch on". The line under the rows shows AI for the
school, whether a provider key is configured, the month's tokens against the
budget, and whether the owner's approval of the AI prompt is recorded.

## Switch on, without AI (allowed now, for a school the owner has approved)

1. Turn on **Assistant panel**. It should read Working.
2. Turn on only the tasks the school should have: **Prepare invoices**,
   **Fee reminder campaigns**, **Add and enrol students**, **Correct student
   records**. Each should read Working.
3. Leave **AI understanding** off.
4. Ask a member of staff to reload. Allow up to 30 seconds for every server
   process to see the change. They should see the Assistant button; a teacher
   should see the panel but none of the four tasks.
5. Check **Activity** for one "Turned … on" entry per switch.

With these five only, no staff text leaves SchoolKit, and no AI privacy or
consent decision is involved.

## AI understanding (not allowed yet)

Do not attempt this for any school until all of the following are true. The
console enforces the first; the rest are yours to check.

1. AO-1 is approved by the owner and merged: the `assistant-orchestrator` row
   is in `CLAUDE.md` and `ASSISTANT_ORCHESTRATOR_APPROVAL` is `"approved"`.
   Until then the row shows "The owner's approval … is not recorded in code
   yet" and switching it on is refused.
2. Every gate in the sign-off register is closed for **that school**:
   counsel, provider facts, published privacy wording, consent version
   decision, the school's own acceptance.
3. The live evaluations pass on the release commit (below).
4. AI is on for the school and it has budget. The row lists "AI is off for
   this school" or "used its AI token budget" if not.

Then: turn on **AI understanding** for that one school, confirm it reads
**Working** with no reasons listed, confirm every other school still reads
Switch off, and run the acceptance matrix with the school.

## Verify on a synthetic school

Use a school that holds only invented staff, students and guardians, with no
real phone numbers or email addresses. A school's name is not evidence of
that: check before you start.

| Check | How | Expect |
|---|---|---|
| Off by default | Open Manage on a new school | Six rows, all Switch off, Not working |
| School cannot self-activate | Sign in as the school's owner | No Assistant control in Settings; the API answers 403 |
| On | Turn on the panel and the four tasks | Rows read Working; staff see the panel after a reload |
| Permissions kept | Sign in as a teacher | Panel opens; the four tasks are unavailable |
| Named lookup | As owner: find a student by name, then by a misspelt name | The right students in a card; a close spelling is offered, never auto-selected |
| Four tasks | Prepare each, change its scope, approve | A changed scope needs a fresh review; nothing is written before approval |
| Status is honest | Turn AI off for the school, look at AI understanding | Not working, "AI is off for this school" |
| Platform kill | Set `FEATURES_DISABLED` (below) | Rows read "Switched off for every school on the server" |
| Rollback | Turn the panel off | Staff lose it after a reload; Activity shows the entry |

The automated versions of these run in CI on every change:
`apps/api/src/__tests__/assistant-activation.spec.ts`,
`e2e/tests/assistant-activation.spec.ts`, and the three
`e2e/tests/assistant-*.spec.ts` journeys (named lookup and all four tasks,
with a scripted model).

AI understanding itself cannot be exercised in production on any school,
synthetic or not, before AO-1: the gate has no exception for a test school,
deliberately. Until then real-model behaviour is verified by the live
evaluations.

## Live-model evaluations

GitHub → Actions → **assistant-live-evals** → Run workflow, on the release
commit. It uses the repository secret; the key is never printed. Every
scenario must run and pass: a skipped scenario fails the run. The scenarios
use an invented school and name markers only, no personal data.

They cover paraphrased requests, follow-up revisions, named lookup, an
ambiguous class, a person without permission, and prompt injection in the
request, the history, the task block and a tool result.

What they show: the real model's choices against the production prompt and
tool definitions. What they do not show: the server's guarantees
(permissions, tenancy, approval, previews), which the PostgreSQL and browser
tests prove with a scripted model. Neither replaces the other.

### Evidence

| Date | Commit | Run | Result |
|---|---|---|---|
| 2026-11-10 | `e277f568`+ (main) | [42925059216](https://github.com/Voclain1/naija-class/actions/runs/42925059216) | 56 passed, 0 failed or skipped (14 scenarios) |
| 2026-11-11 | `acd5dfde` (activation branch) | [43106974613](https://github.com/Voclain1/naija-class/actions/runs/43106974613) | 81 passed, 1 failed (19 scenarios). The failure was real: told only `not_permitted`, the model said results were "not released yet". Fixed in the tool's answer. |
| 2026-11-11 | `607d03b8` (activation branch) | [43107770936](https://github.com/Voclain1/naija-class/actions/runs/43107770936) | 83 passed, 0 failed or skipped (19 scenarios) |

One passing run is one sample of a model that does not answer the same way
every time. It is evidence the prompt and tools behave as intended on these
scenarios, not a guarantee for every phrasing staff will use.

Re-run on the final release commit before any school's AI understanding is
switched on.

## Kill switches, fastest first

1. **One school, one item:** turn its switch off in Manage. Immediate on the
   server that handled it, within 30 seconds everywhere. A running reminder
   campaign halts before its next send.
2. **One school, all AI:** turn **AI** off for the school in the same dialog.
   AI understanding then reads Not working; the panel and tasks keep working.
3. **Every school:** add the keys (or `*`) to `FEATURES_DISABLED` in
   `API_ENV_FILE` and redeploy the API. For AI understanding alone:
   `FEATURES_DISABLED=assistant-model-routing`. Read once at start, so it
   needs the restart.
4. **All AI on the platform:** `AI_ENABLED=false` and redeploy.

After any of these, open Manage on an affected school and confirm the rows
read Not working with the reason you expect.

## Rollback

- Turning switches off is the rollback. Stored switches are per school and
  nothing else is changed by turning them on, so there is nothing to undo.
- Work already approved (issued invoices, sent reminders, saved students)
  stays, with its audit rows. Open previews simply stop being reachable.
- Reverting this change in code removes the status endpoint and the console
  section; the generic switch list still works and no data is affected.

## Stop and switch off if

Any cross-school data appears; a name, contact or record content is seen in
a model-visible place; anything is written without a person's approval on
the card; a switch is found on that nobody recorded. Switch off first, then
investigate (`docs/reviews/virgo-assistant-pilot-signoff-register.md`,
"Release stop conditions").
