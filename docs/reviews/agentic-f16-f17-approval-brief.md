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

### SchoolKit's actual setup (checklist; status 2026-11-08: **none verified**)

The draft paragraph in D3 is final only when every item is confirmed and
recorded here, with who checked it and when.

1. **Provider route.** Calls go directly to the provider's own API, not
   through a cloud reseller whose terms and regions differ.
   *Code observation (2026-11-08), not a verification:* `packages/ai/src/client.ts`
   builds the provider's own SDK client with no base-URL override, which goes
   to the provider's API by default. The SDK also honours an
   `ANTHROPIC_BASE_URL` environment variable. Still to confirm: that
   `API_ENV_FILE` on the VPS sets no such variable, and which organisation the
   deployed `ANTHROPIC_API_KEY` belongs to.
2. **Account agreement.** Which Commercial Terms and Data Processing Addendum
   SchoolKit's organisation accepted, and their dates.
3. **Model.** The model chosen under F-6 has no model-specific retention or
   location terms different from the baseline.
4. **Features.** The assistant uses no feature that keeps data longer: no
   Files API, no batch API, and **no prompt caching over user text** (the
   approved rule). Check any other feature the FD-5c call enables.
5. **Training overrides.** SchoolKit's organisation has **not** opted in to
   training. The assistant sends **no feedback** to the provider; its
   "Was this helpful?" stays in SchoolKit's own analytics, with no text.
6. **Retention overrides.** Whether any longer retention, or a
   zero-data-retention arrangement, applies to SchoolKit's organisation.
   **No zero-retention claim** is made anywhere unless one is confirmed in
   writing for SchoolKit's API organisation, the model chosen under F-6, and
   every feature the assistant enables.
7. **Data residency settings**, if the organisation has any, and whether
   they change where requests are processed.

**The existing privacy policy** describes AI providers as "(United States)"
(`docs/modules/data-protection.md`). The baseline says processing may also
happen in Europe, Asia and Australia, so that line needs updating too.

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
