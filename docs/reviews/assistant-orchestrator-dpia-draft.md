# DPIA: SchoolKit's AI processing of pupils' data

Two processing operations, assessed together because they share a provider,
a transfer and the same open legal questions:

- **Part A:** SchoolKit Assistant, AI understanding (`assistant-orchestrator`).
  Built; **off for every school**; refused in production until approved.
- **Part B:** Smart Student Import (`student-list-extraction`). **Live for
  every school since 2026-10-25** (owner's decision). Part B carries more
  risk, because pupils' personal data is its payload rather than an accident.

**Status: ENGINEERING DRAFT for counsel and a certified DPO. Not a completed
assessment, not legal advice, and not approval of anything.** Drafted
2026-11-12 from the system as built (`main` at the time of writing).

- **Owner of the final document:** SchoolKit, with Virgo Fidelis Montessori
  School as the pilot controller.
- **Who must vet it:** a DPO certified by the NDPC. Commentary on GAID 2025
  says a DPIA must be vetted by one.
- **Template:** GAID 2025 Schedule 4. Commentary describes it as a ten-section
  template; this draft could not reach `ndpc.gov.ng` to read it. The sections
  below follow the usual DPIA order, and counsel should map them onto Schedule
  4's headings and add the article references.

Related:
- the transfer assessment: `assistant-orchestrator-transfer-assessment-draft.md`;
- the pilot packet, consent release specification and sign-off register:
  `virgo-assistant-*.md`;
- the design: `docs/modules/assistant-workspace.md`.

Items marked **[FILL]** need a fact this draft does not have.

---

# Part A: SchoolKit Assistant, AI understanding

## 1. Why a DPIA is required

Commentary on GAID 2025 lists three mandatory triggers, and each applies:

- **Educational services processing pupils' records.** The assistant can find
  pupils and show parts of their records.
- **Cross-border transfer.** Staff text goes to Anthropic in the United States.
- **New technology.** A large language model interprets free text.

Section 28 of the NDPA also requires one where processing is likely to result
in high risk. Children are the most likely subjects of incidental personal
data here, which points the same way.

## 2. Description of the processing

### Purpose

Staff ask for school administration in ordinary words: "prepare second-term
invoices for JSS 2", "remind overdue families", "show Samuel in JSS 2's
attendance". The model chooses which of SchoolKit's existing tools to call.
Every resulting write is still prepared by the server and approved by a person
on a card.

### Parties

| Party | Role (proposed; counsel to confirm) |
|---|---|
| The school (Virgo Fidelis for the pilot) | Controller of its staff's and pupils' personal data |
| SchoolKit | Processor for the school; arguably joint controller of the assistant's design. **Counsel to decide.** |
| Anthropic PBC | Sub-processor (model provider), United States |

### Data subjects

- **Staff** who type requests (owners, admins, bursars, teachers).
- **Pupils, children under 18,** named or described in what staff type.
- **Parents and guardians,** named or described in what staff type.
- **Other staff** mentioned in a request.

Numbers at the pilot school: **[FILL: staff with assistant access, pupils on roll]**.

### What is sent to the model, per request

This is the design as built and as tested.

| Item | Content | Personal data? |
|---|---|---|
| System prompt | Fixed instructions | No |
| Staff messages | The member of staff's typed text: up to 12 messages of up to 1,000 characters, resent each turn | **Possibly, incidentally** (see below) |
| Earlier assistant replies | The model's own replies, re-checked | Only by echo |
| Task summary | Task handles, workflow, status, term and class labels, field names, counts | No |
| Student handles | `s1`, `s2`, with a class label | No; pseudonymous within one conversation |
| Tool results | Term and class labels, counts, statuses, guide excerpts | No |

**Never sent, and tested to be never sent:**
- names, admission numbers and contacts;
- dates of birth;
- money amounts and record ids;
- page content and form values;
- reminder recipients.

The conformance gate plants names, contacts, admission numbers and amounts in
every tool's data and fails CI if any reach the model.

### Before anything is sent

1. **Name replacement.** Names on the school's own roster are replaced with
   markers (`⟨P1⟩`). The server resolves a marker to students and shows them
   to the person, not the model.
2. **Detectors.** Every message, on every turn, is checked for admission
   numbers, email addresses, phone numbers, long ID-like numbers, full dates,
   pasted rows and over-long text. A hit stops the request: no model call is
   made, and the blocked text never re-enters later requests.
3. **Budget and ledger.** The request is reserved against the school's monthly
   token budget and logged in `ai_generations`: model, prompt version, token
   counts, cost, success. No content is logged.

### Storage and retention

| Where | What | How long |
|---|---|---|
| Staff browser | The conversation | Memory only. Cleared on sign-out, account or school change, 15 minutes idle, reload, or "Clear conversation". Never in browser storage, URLs, analytics or error reports. |
| SchoolKit servers | No question or reply text. One content-free interaction row and one ledger row per model call. | Ledger: **[FILL: retention policy for `ai_generations`; none is set today]** |
| Anthropic | Each request and response | Organisation default observed in the console: **30 days**; zero retention not enabled. The production key's organisation and the governing terms are not yet confirmed. |

### Access

- **Who can use it:** the platform admin switches it on per school, and it is
  off by default. Each tool re-checks the person's permissions and the school
  on every call.
- **Teachers:** see only their own classes in a lookup.
- **Behaviour, health, contact details and unreleased results** are not
  available to the assistant at all.

## 3. Necessity and proportionality

| Question | Answer as built | For counsel |
|---|---|---|
| Is personal data needed for the purpose? | No. The tasks need class, term and field choices, and the tools return labels and counts only. | Personal data reaches the model only incidentally. |
| Could the purpose be met without the model? | Partly. The panel already works without it, by buttons and fixed phrases. The model adds understanding of free wording and follow-ups. | Is that benefit proportionate to the residual risk? |
| Data minimisation | Roster names replaced; detectors; no record content in model input; 12-message cap. | |
| Lawful basis | **Open.** Candidates: the school's legitimate interests or contract for staff data. For children's data that arrives incidentally, the basis and any parental consent requirement are the central question. | Decide. |
| Transparency | **Open.** Draft staff notice, privacy-policy text and parent notice are in `virgo-assistant-consent-release-spec.md`; none is published. | Approve the wording. |
| Data subject rights | SchoolKit holds no conversation text to give access to or erase. Anthropic holds it for up to 30 days, and SchoolKit cannot retrieve it. | Is that acceptable, and how is it explained? |

## 4. Risks

Likelihood and severity are engineering estimates for counsel to revise.

| # | Risk | Likelihood | Severity | Notes |
|---|---|---|---|---|
| R1 | A child's or parent's identity reaches the provider through what staff type: a name not on the roster, a nickname, a misspelling, or a description ("the boy whose father died"). | **Likely** over weeks of use | Medium | The main residual. Not detectable by pattern. |
| R2 | Sensitive data reaches the provider: health, family circumstances, discipline, religion or ethnicity, written as sentences. | Possible | **High** | No detector for sensitive topics. |
| R3 | Data held at the provider is disclosed, through a provider breach or lawful access in the US. | Unlikely | High | See the transfer assessment. |
| R4 | The provider uses the data to train models. | Unlikely if commercial terms apply | High | Terms not yet confirmed for the production key's organisation. |
| R5 | The model misunderstands and prepares the wrong work, such as the wrong classes or term. | Possible | Low to medium | Every write needs a person's approval on the server's own preview; a changed scope invalidates earlier approval. |
| R6 | Prompt injection, from typed text or school-entered labels, makes the assistant act beyond the request. | Possible | Low | No approval or execution tool exists. Tools only read or prepare. Live evaluation covers injection in requests, history, task block and tool results. |
| R7 | Cross-school exposure. | Rare | High | Tenant isolation at the database (row-level security), re-checked per tool call; tested. |
| R8 | A conversation is seen on a shared or unattended computer. | Possible | Low to medium | Memory only; 15-minute clear; cleared on sign-out. |
| R9 | Staff use named lookup to view pupils without need. | Possible | Medium | Limited by each person's permissions and, for teachers, their own classes. **Lookups are not individually audited.** Neither are views on the Students page. |
| R10 | Parents are unaware their children's data may reach an AI provider. | **Certain** until a notice goes out | Medium | Notice or consent decision pending. |
| R11 | A data subject asks for access or erasure, and SchoolKit cannot recover what was sent. | Unlikely | Low to medium | No text stored by SchoolKit; provider holds it for 30 days. |

## 5. Measures

### Already in place

- Off by default. Only the platform admin can switch it on, per school, and
  every change is audited.
- Production refuses the prompt until the owner's approval is recorded in code
  (AO-1).
- Roster-name replacement and detectors on every message, every turn. Blocked
  text is never resent.
- Tools return labels and counts only, enforced by a CI conformance gate.
- No approval tool. Every write needs a person's approval on the server's
  preview.
- Memory-only conversation with automatic clearing. No content stored, logged
  or sent to analytics.
- Monthly token budget per school, a per-user daily cap and a cost ledger.
- Kill switches: per school, per feature platform-wide (`FEATURES_DISABLED`)
  and all AI (`AI_ENABLED`).
- A live evaluation of the real model before release: 19 scenarios, 83 of 83
  checks passing on 2026-11-11.

### Proposed, for counsel to require or waive

| For | Measure | Effort |
|---|---|---|
| R1, R2, R10 | Staff notice in the panel before first use, and the published privacy text. Draft exists. | Small |
| R1, R2 | A sensitive-topic warning (health, family, discipline words) that asks before sending. It reduces but does not remove R2. | 1–2 days |
| R3, R4, R11 | Confirm the production key's organisation and its terms; ask Anthropic for zero data retention. | Owner; Anthropic's timing |
| R9 | Audit each named lookup (who looked up which student, when), with no text. | 1 day |
| R10 | Parent notice, or consent if counsel requires it. | School's timing |
| R11 | Explain the 30-day provider retention in the notice; refer requests to the provider route if counsel says so. | Wording |
| All | A pilot limited to one school, a named monitoring owner, and the stop conditions in the sign-off register. | In place as process |
| Ledger | Set a retention period for `ai_generations` rows. | Small |

## 6. Residual risk after the measures

R1 remains likely; that is what AO-1 accepts in writing. Severity is lowest
when staff are told, the sensitive-topic warning is in place, and the provider
retains nothing. R2 is reduced but not removed. Everything else is low with
the measures above.

**Counsel's conclusion: [FILL]**, one of:
- acceptable;
- acceptable with conditions;
- prior consultation with the NDPC needed;
- not acceptable.

## 7. Consultation

- **Staff at the pilot school:** [FILL: who, when, outcome]
- **Parents:** [FILL: notice or consent, per counsel]
- **DPO certification and vetting:** [FILL: name, NDPC accreditation, date]

## 8. Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Certified DPO (vetting) | | | |
| Counsel | | | |
| SchoolKit owner | | | |
| Pilot school (controller) | | | |

**Review date:** before any school other than the pilot is switched on, and on
any change to what the model receives.

---

# Part B: Smart Student Import (`student-list-extraction`)

**Status: in production for every school since 2026-10-25.** Migration
`20261125120000_ai_and_smart_import_on_for_all_schools` set `smart_import_enabled`
and `ai_enabled` true for every existing school and made both the default for
new ones. The owner's decision is recorded in
`docs/modules/smart-student-import.md` §9 ("the beta"). A school can scan only
after its owner or an admin accepts a first-use notice. This is a DPIA for
processing that has already started. Counsel should say whether that changes
what must happen now.

## B1. Why a DPIA is required

The same three GAID triggers apply as in Part A, more directly:
- educational records of pupils;
- a cross-border transfer;
- new technology (a vision model reading handwriting).

Unlike Part A, children's identity is the payload, not an accident.

## B2. Description of the processing

### Purpose

An admin photographs a paper class register. The model reads each row into
the fields of a student registration. The admin checks every row against the
paper, ticks "I have checked these rows against the register", and saves.
Nothing is written to student records without that.

### Data subjects

Pupils (children) and their parents or guardians, as written on the register.
Volume: **[FILL from Super-admin → Smart Import beta results: schools that
agreed, pages read, rows read since 2026-10-25]**.

### What is sent to the provider, per scan

| Item | Personal data? |
|---|---|
| The photo of one register page, sent once as image data | **Yes:** everything written on the page |
| Fixed instructions to read the page | No |
| The class level | No |

### What the model returns

Per row: first, middle and last names, gender, date of birth, admission
number, class, guardian's name, guardian's phone number, and the fields it
could not read.

### Storage and retention

| Where | What | How long |
|---|---|---|
| SchoolKit, the photo | Not stored. Sent once, held only in memory for the request (D3, "never persisted"). | Request only |
| **SchoolKit, `import_jobs.preview_snapshot`** | **Every row the model read, with all fields above, including rows the admin removed and guardian phone numbers** | **Until someone deletes the import job. No automatic clearing.** See finding F1. |
| SchoolKit, student records | Only the rows the admin checked and saved | The school's normal records |
| SchoolKit, `import_jobs.scan_review` | Counts only, no text; a test fails if a name appears | Kept |
| SchoolKit, `ai_generations` | Metadata only, no content | **[FILL: retention policy]** |
| Anthropic | The photo and the extracted rows | Organisation default observed: **30 days**. Zero retention not enabled. Production key's organisation not confirmed. |

### Notice and agreement

- **At sign-up**, the school's owner accepted wording that does not mention AI
  providers (`docs/legal/ndpr-ai-review.md`, "What the school agreed to").
- **Before the first scan**, an owner or admin presses "I agree for my school"
  after this notice. The agreement is stored with a timestamp and audited, and
  the API refuses scans without it:

  > When you take a photo, SchoolKit sends it to the AI reading service it
  > uses, to read the page. The photo is not kept: once the page has been
  > read, it is thrown away, and nothing from it is saved except the rows you
  > check and save.

- **What the notice does not say:** it names no provider (owner's rule) and
  does not say the photo leaves Nigeria. It is not versioned, so a change in
  wording cannot ask schools again.
- **Parents:** no notice or consent.

## B3. Findings from preparing this draft

**F1. The notice overstates what is deleted.** The photo is thrown away, but
"nothing from it is saved except the rows you check and save" is not true as
built:
- Every row the model read stays in `import_jobs.preview_snapshot`, including
  rows the admin removed as wrong or unwanted, with guardian phone numbers.
- It stays until someone deletes the import job by hand.
- It is protected by tenant isolation (row-level security) like other school
  data, but it is kept indefinitely.

Fix options for counsel and the owner:
- clear the snapshot when the import is saved or abandoned, keeping only the
  counts already in `scan_review` (about a day of engineering, plus cleaning
  up existing jobs);
- or change the notice wording, which, being unversioned, means deciding how
  to re-ask schools.

**F2. The school's agreement is not the parents'.** The first-use agreement is
the controller's. Whether parents need notice or consent for their children's
data going to a provider outside Nigeria is open (`ndpr-ai-review.md` Part 2,
questions 8 to 10).

**F3. The legal review said this would stay off.** `docs/legal/ndpr-ai-review.md`
Part 1 (unsigned draft, 2026-10-11) said Smart Import stays off until the
lawyer has answered. The owner's later decision of 2026-10-24 put it on for
every school. That document now records both. Counsel will see the sequence.

## B4. Necessity and proportionality

| Question | Answer as built | For counsel |
|---|---|---|
| Is personal data needed? | Yes. Transcribing the register is the product; there is nothing to make opaque. | Accepted in the allowlist (2026-08-20), but not legally assessed. |
| Could it be done without sending data abroad? | Only by typing or a CSV, which already exist. | Is the time saved proportionate? |
| Minimisation | One page per request; photo not stored; guardian fields are optional on the page. | F1 undermines the storage half. |
| Lawful basis | **Open.** The school's agreement; the basis for children's data and the transfer is unassessed. | Decide. |
| Transparency | First-use notice to the school; nothing to parents; provider and country not named. | Adequate? |

## B5. Risks

| # | Risk | Likelihood | Severity | Notes |
|---|---|---|---|---|
| B-R1 | Children's names, dates of birth and guardians' phones go to a provider in the US without a settled lawful basis or transfer mechanism | **Certain** on every scan | High | The core of this part |
| B-R2 | Extracted rows, including rejected rows, kept indefinitely in `preview_snapshot` | **Certain** today | Medium | F1 |
| B-R3 | A misread wrong name or date of birth goes onto a permanent record | Possible | Medium | Mitigated by the required row-by-row check and the "unreadable" marking; measured in the beta results |
| B-R4 | A notice that names no provider or country is judged insufficient | Possible | Medium | F2 and wording |
| B-R5 | A register from another school, or a page with other details (health notes, fees), is photographed | Possible | Medium to high | The notice asks for own-school registers only. Nothing on the page is filtered before sending. |
| B-R6 | Provider breach, lawful access or training use | Unlikely | High | As Part A, R3 and R4 |
| B-R7 | Parents unaware | **Certain** | Medium | No parent notice |

## B6. Measures

**In place:**
- the first-use agreement, enforced by the API;
- the photo never stored;
- the required row check before save;
- unreadable fields marked;
- a per-school switch, the monthly budget and `AI_ENABLED`;
- the beta results, which hold counts only.

**Proposed:**

| For | Measure | Effort |
|---|---|---|
| B-R2, F1 | Clear `preview_snapshot` on save or abandon; clear existing jobs | About 1 day |
| B-R4, F2 | A versioned notice that names the provider and the country, re-asked of schools that already agreed | Wording plus a small change |
| B-R1, B-R7 | Parent notice, or consent, as counsel decides | School's timing |
| B-R1 | Pause for schools that have not yet scanned until counsel answers question 10 | Owner's decision; per-school switch |
| B-R6 | As Part A: confirm the key's organisation and terms; ask about zero retention | Owner |

## B7. Residual risk and conclusion

**Counsel's conclusion: [FILL]**, including whether processing should continue
while the assessment is completed.
