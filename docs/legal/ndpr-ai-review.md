# Data protection and the AI features

Two parts:

1. A decision for the owner to sign: keep the AI features running while a
   lawyer reviews them, and on what terms.
2. A brief for that lawyer: what the product sends, to whom, and the questions
   it needs answered.

Status: **DRAFT, 2026-10-11. Not yet signed.** Until it is signed, the item in
`docs/deferred.md` §3 stays open. Background: `docs/deferred-archive.md`,
"NDPR compliance posture for third-party AI / embeddings vendors".

---

## Part 1. Decision to proceed while the review is pending

**Decision.** SchoolKit keeps its AI features available to schools that have
been switched on for them, while an independent data-protection review is
carried out, on these conditions:

1. **No new AI processing of student personal data.** The rule in `CLAUDE.md`
   stays in force: derived features (comments, summaries, insights, lesson
   plans, exam questions) send opaque ids and class-level context only, never
   a student's name, address, date of birth or contact details.
2. **Smart Student Import stays off for every school** (`School.smartImportEnabled`,
   off by default since 2026-10-11). It is the one feature that sends
   children's names to the AI provider. It stays off until the lawyer has
   answered the questions in Part 2 that concern it, and its accuracy check
   has passed.
3. **AI is switched on one school at a time**, by the platform operator, with
   the school's agreement. No school gets AI by default.
4. **Parent summaries stay a school's own opt-in** (`parentSummaryEnabled`),
   never switched on by SchoolKit.
5. **The student AI tutor (Phase 8b) is not covered by this decision.** It
   needs its own, after the safeguarding work in `docs/modules/phase-8.md` §6.4.
6. **The review is commissioned by:** _______ (date).
   If it is not done by then, this decision is reconsidered, not renewed
   silently.
7. **If the lawyer finds a problem**, AI is switched off for every school
   (`AI_ENABLED=false` on `school-kit-api`) until it is fixed.

**Why proceed rather than pause.** The volume is small (one school switched
on at the last count, on a capped monthly budget), the engineering rules already keep student
identity out of every derived feature, and pausing would take away report
comment and lesson-plan drafts that teachers are using. The risk being
accepted is that the legal basis for sending school data to providers outside
Nigeria has not been confirmed by someone qualified.

Signed: ______________________ (Arinzechukwu), date: __________

---

## Part 2. Brief for the data-protection lawyer

### What SchoolKit is

A school-management platform for Nigerian private schools: student records,
attendance, fees, results, parent communication. Each school is a separate
tenant. SchoolKit acts for the school (the school decides what is recorded;
SchoolKit holds and processes it), so SchoolKit's working assumption is that
the school is the data controller and SchoolKit its processor. Please confirm
or correct that.

### The AI providers

| Provider | Used for | Where | What it receives |
|---|---|---|---|
| Anthropic (Claude) | Writing drafts and reading register photos | Outside Nigeria (US) | See the feature list below |
| Voyage AI | Turning curriculum documents into search vectors | Outside Nigeria (US) | Curriculum text uploaded by the school (schemes of work, textbooks). No student data. |

### What each AI feature sends

| Feature | Who uses it | Sends | Student personal data? |
|---|---|---|---|
| Report-card comment drafts | Teachers | One student's scores, attendance rate, subject and class level | No name, admission number, date of birth, gender or contact detail. The draft is written without a name. |
| Form-teacher comment drafts | Teachers | As above, across subjects | No |
| Lesson plans and quizzes | Teachers | Subject, topic, class level, curriculum text | No |
| Exam question drafts | Teachers | Subject, topic, class level | No |
| School insights ("ask a question about your school") | Owners, admins | Aggregate figures (attendance rates, fee totals) | No |
| Weekly parent summaries | Sent to parents, if the school opts in | One child's week of scores and attendance, and class level | No identifying details are sent, but the data is about one child, and the summary goes to that child's parent |
| Smart Student Import | Admins | **A photo of a class register: children's names, dates of birth, guardians' names and phone numbers** | **Yes. Switched off for every school.** |

Every AI draft is reviewed by a teacher before anyone else sees it, except the
parent summaries, which go to the parent directly once the school has opted
in. The register photo is not stored by SchoolKit; it goes to the provider in
a single request and is discarded.

### What the school agreed to

At sign-up, the school's owner ticks a box after this text (onboarding step 4):

> SchoolKit will:
> - Store your students', staff's, and parents' details to deliver the service.
> - Only share data with payment, SMS, and email providers when you trigger an action that requires it.
> - Never sell your data or use it to train AI models without your explicit opt-in.
> - Comply with the Nigeria Data Protection Regulation (NDPR).
>
> I have read and accept the data handling terms above on behalf of my school.

Note that the list of providers does **not** name AI providers.

### Questions

**The law that applies**

1. The consent text names the NDPR. Does the Nigeria Data Protection Act 2023,
   and the Commission's guidance under it, now govern instead? What should our
   documents cite?
2. Is SchoolKit a processor for the schools, as we assume, or a controller for
   any of this processing (for example for the aggregate insights)?
3. Does SchoolKit need to register with the Nigeria Data Protection Commission,
   or file audits, at its size?

**Sending data outside Nigeria**

4. What is the lawful basis for sending school data to Anthropic and Voyage in
   the US? Is an adequacy finding, contract clauses, or consent required?
5. Does sending de-identified data (scores under an opaque id, with no name)
   count as a transfer of personal data at all?
6. What must our contracts with Anthropic and Voyage contain? Do their standard
   data-processing terms meet that? This includes how long each keeps data, and
   their own sub-processors. Voyage's retention terms in particular have not
   been read.

**Consent and notice**

7. Does the step-4 text above cover AI processing? If not, what wording would,
   and do schools that already accepted it need to accept again?
8. Do parents need to be told, or to consent, given they are not SchoolKit's
   customer? Is the school responsible for telling them?
9. Children: does processing pupils' data need anything beyond the school's
   agreement (parental consent, an age threshold)?

**Smart Student Import specifically**

10. Can SchoolKit send photos of registers, with children's names and guardians'
    phone numbers, to a provider outside Nigeria, if the image is not kept by
    SchoolKit and is sent in a single request? What would make it acceptable?

**Rights and records**

11. How must SchoolKit support access, correction and deletion requests for
    data that was sent to a provider? (SchoolKit keeps a log of each AI call
    without its content.)
12. What records of processing, and what breach-notification process, should
    SchoolKit keep?

**The student tutor (planned, not built)**

13. A planned AI tutor would let children type to the model freely. Apart from
    data protection, what do the Child's Rights Act, state child-protection
    laws and any mandatory-reporting duty require? (See `docs/modules/phase-8.md`
    §6.4. This is for planning only; nothing will be built before it is answered.)

### Other providers, for completeness

SchoolKit also uses, for the rest of the service: Paystack (payments), Termii
(SMS), Resend (email), Cloudflare R2 (file storage), Neon (database), Fly.io and
Vercel (hosting), Sentry (error reports, with personal details removed) and
PostHog (product analytics, ids only). The review may as well cover them,
since several are outside Nigeria too.

### Facts to gather before the meeting

- How many schools have AI switched on (platform admin, the AI column).
- Which AI features have actually run, from each school's AI Usage page.
- Anthropic's and Voyage's current data-processing terms.
