# DPIA: SchoolKit Assistant, AI understanding (`assistant-orchestrator`)

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
