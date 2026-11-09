# Approval brief: personal data in help-assistant questions (F-16, F-17)

## Approval record

**2026-11-08, the owner approved:**

- **D1:** option **A**, for a **limited pilot**.
- **D2:** the **narrowly scoped `help-assistant` exception**, as worded below. It is now
  in `CLAUDE.md` (third allowlist row, and how rule 1 applies), and the eval
  suite's pin is updated in the same change.
- **D7:** option **(b)**, store no question or reply text.
- **D8:** the browser handling below, with the 15-minute inactivity limit.

**Not approved by this record, and still open:**

- **D3: the privacy-policy wording.** It is completed from the public baseline, for review. It is final only when the D6 checklist is done.
- **D4: consent versions.** The recommendation below is for the owner's decision. Approving this brief does not resolve it.
- **D5: legal review.** The help assistant is added to
  `docs/legal/ndpr-ai-review.md` (condition 5a, question 14). The review itself is unsigned.
- **D6: provider terms.** The provider's **official public baseline** is recorded (verified externally on 2026-11-08; see D6). SchoolKit's own account, route, model, features and overrides are **not verified**: the D6 checklist.
- **Three wording corrections, given by the owner on 2026-11-08 and applied the same day.** They clarify the recorded approval and do not approve pilot activation:
  1. **History sent to the provider.** The privacy paragraph says each request sends the current question and the earlier messages of the conversation, with the retrieved guide sections and the settings the staff member may see.
  2. **Provider location and retention.** The unverified "United States" and the retention placeholder are replaced by sourced fields that separate processing location from storage location. No zero-retention claim is made unless it is confirmed for SchoolKit's API organisation, the chosen model and the enabled features (D6).
  3. **Read-only does not mean no records.** "Writes to no record" becomes: "The assistant cannot modify school operational records. Usage, security and execution metadata are still recorded, without question or reply text." This is applied in `CLAUDE.md` and here.

**Pilot activation is separately gated.** No school's help-assistant switch
is turned on until all of these are true:
- the provider (D6), privacy (D3), legal (D5) and consent (D4) work is complete;
- the FD-5c evaluations pass;
- the owner has selected the pilot schools.

Until then every assistant switch stays off. Approving D1 and D2 does not
switch anything on. Background and the options compared:
`agentic-implementation-plan.md` §3.6.

## The decisions

| # | Decision | Proposed | Alternatives |
|---|---|---|---|
| D1 | F-16: how free text reaches the model | **A** (free text, detect and block), pilot schools only, and only after D2–D6 | B (stricter blocking), **C** (no free text to the model: fixed questions or guide search only; needs none of D2–D6) |
| D2 | `CLAUDE.md` AI rule | Add the allowlist row and rule application below | Amend the rule itself (broader, close to a "category") |
| D3 | Privacy policy | Add the paragraph below to the marketing site's policy | Different wording |
| D4 | Consent versions | Bump `SCHOOL_CONSENT_VERSION`; decide `PARENT_CONSENT_VERSION` with the lawyer | No bump (only if the lawyer advises the wording changes nothing agreed) |
| D5 | Legal review | Add the help assistant to `docs/legal/ndpr-ai-review.md` before any pilot | — |
| D6 | Provider terms | Confirm from named sources: processing location, storage location and retention (with exceptions), and training; fill the brackets in D3. No zero-retention claim unless confirmed for SchoolKit's organisation, model and features | — |
| D7 | F-17: server storage of question and reply text | **(b)** store none; metadata only | (a) store in `ai_interaction_logs`; (c) short-retention table |
| D8 | Browser handling | The rules below, with a **15-minute** inactivity limit | Another limit |

## D2: exact proposed `CLAUDE.md` wording

In "The PII-bearing prompt allowlist", change "Exactly two prompts are
permitted" to "Exactly three prompts are permitted", add the approval date
and sign-off to the heading line, and add this row:

> | `help-assistant` | Help and settings assistant for staff (`docs/reviews/agentic-implementation-plan.md` §3.6, FD-5) | **Not the payload — incidental, and accepted as a residual.** The assistant needs no personal data and staff are asked not to give it any. A staff member may still type or paste some. Mitigated, not exempted: before the model, per-school detectors block names on the school's own roster, phone numbers, email addresses, long ID-like numbers, full dates and pasted rows; a standing notice asks for none; the assistant's tools return school settings and guide sections only (the FD-3b gate). What the detectors miss reaches the model: this row accepts that residual for this prompt only. Optional at every level: the platform's switch, the school's own switch (off by default), and the staff member's choice to ask. |

Under the two binding rules, add:

> **How rule 1 applies to `help-assistant`, the only conversational prompt on
> this list.** "The single request" is one request to the conversation API.
> The conversation is held only in the staff member's browser memory (never
> browser storage), cleared on sign-out, on any change of account or school,
> and after 15 minutes without activity, and resent with each request. The
> server keeps it only while handling that request, re-checks all of it with
> the detectors, stores no question or reply text, and puts it in no queue,
> cache, log, error report or analytics event. No prompt caching covers it.
> The model provider receives it on each request, under its API data terms.
>
> **Rule 2** holds as written, with this clarification: the assistant cannot
> modify school operational records. Usage, security and execution metadata
> are still recorded, without question or reply text.

And pin `help-assistant` in the eval suite's list of allowlisted prompts in
the same change.

## D3: privacy-policy paragraph (draft for review; final after the D6 checklist)

> **Help assistant (only if your school switches it on).** Your staff can ask
> SchoolKit questions about using the product. Each time a staff member asks,
> we send an AI model provider the current question **together with the
> earlier messages of the same conversation**, the relevant parts of our help
> guide, and those of your school's settings the staff member is allowed to
> see, such as its grading bands and term dates. We ask staff not to include
> anyone's personal details, and we block a question, or a conversation, when
> we recognise a name from your school, a phone number, an email address, an
> ID number, a full date or a pasted list. We cannot recognise every personal
> detail, so some may reach the provider. We do not keep the questions or the
> answers on our servers. We do keep a record that a question was asked and
> how it was handled (for example the time, which tools were used, and
> whether it was blocked), never the question or the answer. The conversation
> stays in the staff member's browser and is cleared when they sign out,
> switch account or school, or stop using it for 15 minutes.
> The provider may process each request in the United States, Europe, Asia
> or Australia, and stores what it keeps in the United States. It deletes the
> questions and answers it receives within 30 days, unless a longer period is
> agreed with it, a storage feature is used, or it must keep them longer to
> enforce its usage policies or to comply with the law. It does not use them
> to train its models unless we opt in or send it feedback, and we do
> neither.

**Status of this paragraph: draft for review.** The location, retention and
training sentences are written from the provider's **official public
baseline** (D6, verified externally on 2026-11-08). They describe the
provider's default terms. They become final only once the D6 checklist
confirms SchoolKit's own account matches that default; the last sentence
("we do neither") is a commitment SchoolKit must keep and check (D6 items 5
and 6).

## D6: provider terms

### Official public baseline (verified externally on 2026-11-08)

Recorded from the owner, who verified these official pages on 2026-11-08.
They were not accessed from this session (its network does not reach them).

| Topic | Published guidance | Source |
|---|---|---|
| Retention | Standard API inputs and outputs are deleted within **30 days**, with exceptions for arrangements agreed with the provider, storage features, usage-policy enforcement, and law. | https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data |
| Training | Commercial API inputs and outputs are **not used for training by default**; an explicit opt-in or submitted feedback can change that. | https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training |
| Locations | **Processing** by default may occur in the **United States, Europe, Asia and Australia**. **Stored** data is in the **United States**. | https://privacy.claude.com/en/articles/7996890-where-are-your-servers-located-do-you-host-your-models-on-eu-servers |

This is the provider's **default** for its own API. It is not a statement
about SchoolKit's account, which the checklist below covers.

### D6 part 1: technical checks (done 2026-11-09, from the repository; no key or secret read)

Checked against `main` at 16365be (code, `.env.example`, `infra/`, `.github/`).
The deployed environment file is a GitHub secret (`API_ENV_FILE`) this
session cannot read, so what it contains is listed as unconfirmed, not
guessed.

| Check | Finding |
|---|---|
| **Effective endpoint** | The code builds the provider's own SDK client (`packages/ai/src/client.ts`) with no base-URL option, which goes to the provider's own API. No `ANTHROPIC_BASE_URL`, base-URL override, or reseller route (Bedrock, Vertex) appears anywhere in code, `.env.example`, `infra/` or the workflows. **Unconfirmed:** the SDK also honours an `ANTHROPIC_BASE_URL` environment variable, and `deploy-vps.yml` passes `API_ENV_FILE` through except for database, Redis, port and job settings, so a value set there would take effect. A code change can close this regardless of the secret's contents (pin the endpoint in the client). |
| **Models in use** | `claude-haiku-4-5`: report-card and form-teacher comments, insights (router and narration), weekly parent summaries, assignment feedback, the connectivity check, and the billing-run planner (#512). `claude-sonnet-5`: lesson plans and quizzes, exam questions, register extraction. **The help assistant has no prompt or model yet** (F-6 open). |
| **API features used** | The Messages API only (`messages.create`), with: tool use (the conversation loop: help-assistant tools and the billing planner's two tools); structured output (`output_config` with a JSON schema) on single calls; image input (register photos). No `thinking` parameter is sent, so each model's default applies (Sonnet 5 adaptive thinking on; Haiku 4.5 off). No `metadata`, no service tier, no beta features. |
| **Caching, files, batches** | None: no `cache_control`, no Files API, no Message Batches API, no beta namespace. |
| **Feedback or text sent elsewhere** | No call to any provider feedback endpoint. The API's PostHog sends one event (`validation_rejected`) carrying field shapes, not text. Sentry redacts emails and phone numbers. The only other AI provider, the curriculum search-indexing provider, receives curriculum documents a school uploads, never questions or student data. The help assistant has no "Was this helpful?" yet (FD-5e), so nothing about it is sent anywhere today. |
| **What the billing planner (#512) sends** | A fixed task sentence and its own tool results (counts only). No typed text, school-entered strings, names or amounts. |

### D6 part 2: account facts still missing (need the API organisation's settings or agreements)

1. **Organisation:** which provider organisation the deployed API key belongs to (name or id, not the key).
2. **Agreements:** the Commercial Terms and Data Processing Addendum that organisation accepted, and their dates.
3. **Training:** confirmation that the organisation has not opted in to training, and has not submitted feedback through the provider's channels.
4. **Retention:** any arrangement that changes the 30-day default for the organisation: longer retention, or zero data retention (zero retention is claimed nowhere unless confirmed for this organisation, model and features).
5. **Residency:** any data-residency or regional-processing setting on the organisation.
6. **Model exceptions:** any model-specific retention or location terms for the model chosen under F-6 (and for Haiku 4.5 and Sonnet 5, already in use).
7. **Endpoint in production:** confirmation that `API_ENV_FILE` sets no `ANTHROPIC_BASE_URL` (or the pin above, once merged, makes this moot).

### Correction to the existing privacy-policy line (proposed, with D3)

The marketing site's privacy policy lists AI providers as **"AI model
providers (United States)"** (`docs/modules/data-protection.md`). That is not
right for the provider SchoolKit uses for drafting and the assistant, and it
says nothing verified about the other. Proposed replacement, still naming no
company (owner's rule, 2026-10-24):

> - **AI model provider** (writing drafts, reading register photos, the help
>   assistant and preparing billing previews): may process requests in the
>   United States, Europe, Asia or Australia; stores what it keeps in the
>   United States; deletes it within 30 days unless a longer period is agreed,
>   a storage feature is used, or it must keep it to enforce its policies or
>   comply with the law; does not train on it unless we opt in or send it
>   feedback, and we do neither.
> - **Curriculum search provider** (turns curriculum documents a school
>   uploads into search data; never student data): [location and retention
>   not yet verified: its terms have not been read (legal review, question 6)].

Like D3, the first item is written from the provider's public baseline and is
final only when part 2 confirms SchoolKit's account matches it.

## D4: consent versions (recommendation, for the owner's decision)

- **`SCHOOL_CONSENT_VERSION`: bump.**
  - The school's step-4 agreement says data is shared only with payment, SMS and email providers, and does not name AI providers (legal review, "What the school agreed to").
  - The help assistant sends staff-typed text, which may include personal details, to an AI provider.
  - That is a new purpose, so schools should accept again before any pilot.
- **`PARENT_CONSENT_VERSION`: decide with the lawyer (question 14).**
  - If the final policy wording changes what parents agreed to, bump it. That asks every parent again.
  - If the lawyer advises that the school-side notice suffices, do not.
- **Neither bump is made until the owner decides.** Each is a one-line change plus the wording it versions.

## D8: proposed browser handling (FD-5d acceptance criteria)

- In the panel's memory only. Never in `localStorage`, `sessionStorage`,
  IndexedDB, cookies, the Cache API or a service worker, the URL or title, or
  any analytics or error report. A blocked draft is handled the same way.
- Cleared on: sign-out; any forced end of the session; any change of account
  or school (checked before each turn and on focus); **15 minutes** without a
  message sent or received, measured from timestamps, and enforced by the
  server refusing resent history for an idle conversation; tab close or
  reload; the Clear button.
- A Playwright test for each.

## What stays true whatever is decided

- Undetected personal data can reach the provider under option A or B. D2 is
  the decision to accept that residual; the detectors do not remove it.
- Detection is per school. False blocks happen and are recorded case by case.
- Storing text (D7 a or c) would not give SchoolKit support or the school's
  owner a way to read it; a support view would be a separate feature with its
  own approval, per-request consent and an audit row per read.
