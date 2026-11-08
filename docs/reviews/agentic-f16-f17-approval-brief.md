# Approval brief: personal data in help-assistant questions (F-16, F-17)

**Status: proposed. Nothing in this brief is approved.** Each decision below
is the owner's, separately. Conversational input stays paused and every
assistant switch stays off until they are made. A pilot approval, by itself,
decides none of them. Background and the options compared:
`agentic-implementation-plan.md` §3.6.

## The decisions

| # | Decision | Proposed | Alternatives |
|---|---|---|---|
| D1 | F-16: how free text reaches the model | **A** (free text, detect and block), pilot schools only, and only after D2–D6 | B (stricter blocking), **C** (no free text to the model: fixed questions or guide search only; needs none of D2–D6) |
| D2 | `CLAUDE.md` AI rule | Add the allowlist row and rule application below | Amend the rule itself (broader, close to a "category") |
| D3 | Privacy policy | Add the paragraph below to the marketing site's policy | Different wording |
| D4 | Consent versions | Bump `SCHOOL_CONSENT_VERSION`; decide `PARENT_CONSENT_VERSION` with the lawyer | No bump (only if the lawyer advises the wording changes nothing agreed) |
| D5 | Legal review | Add the help assistant to `docs/legal/ndpr-ai-review.md` before any pilot | — |
| D6 | Provider terms | Confirm the AI provider's API data terms (what it keeps, how long, where, no training) and fill the bracket in D3 | — |
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
> **Rule 2** holds as written: the assistant's tools are read-only and it
> writes to no record.

And pin `help-assistant` in the eval suite's list of allowlisted prompts in
the same change.

## D3: exact proposed privacy-policy paragraph

> **Help assistant (only if your school switches it on).** Your staff can ask
> SchoolKit questions about using the product. Each question is sent to an AI
> model provider (United States), with the relevant parts of our help guide
> and some of your school's settings, such as its grading bands and term
> dates. We ask staff not to include anyone's personal details, and we block a
> question when we recognise a name from your school, a phone number, an email
> address, an ID number, a full date or a pasted list. We cannot recognise
> every personal detail, so some may reach the provider. We do not keep the
> questions or the answers on our servers; the conversation stays in the staff
> member's browser and is cleared when they sign out or stop using it for 15
> minutes. [Provider terms, to be confirmed under D6: what the provider keeps,
> for how long, and that it does not use it to train its models.]

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
