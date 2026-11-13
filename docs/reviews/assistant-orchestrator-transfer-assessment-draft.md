# Transfer assessment: pupils' data to Anthropic (United States)

**Status: ENGINEERING DRAFT for counsel. Not legal advice and not approval.**
Drafted 2026-11-12. It accompanies `assistant-orchestrator-dpia-draft.md`.

- **What it covers:** two transfers from Nigeria to Anthropic PBC in the
  United States:
  - **A.** Staff-typed text that may incidentally hold pupils' and parents'
    personal data (`assistant-orchestrator`; off for every school).
  - **B.** Photos of class registers, deliberately holding pupils' names,
    dates of birth and guardians' names and phone numbers
    (`student-list-extraction`, Smart Import; **live for every school since
    2026-10-25**). See §8.
- **Gap in this draft:** commentary on GAID 2025 says a transfer impact
  assessment is required where transfer safeguards such as standard
  contractual clauses are used, and that the NDPC must approve those. The
  exact article numbers and template are not reproduced here because this
  draft could not reach `ndpc.gov.ng`; counsel should add them.

## 1. The transfer

| Item | Detail |
|---|---|
| Exporter | SchoolKit (on behalf of the school) **[counsel: confirm roles]** |
| Importer | Anthropic PBC, Messages API |
| Country | United States **[FILL: confirm processing and storage locations for the production organisation]** |
| Data | Staff-typed requests and the model's replies, resent each turn (up to 12 messages of up to 1,000 characters). Labels and counts from tools. See DPIA §2. |
| Personal data | Not intended. Incidentally: names, descriptions or circumstances of pupils, parents or staff that pass name replacement and the detectors. Possibly sensitive (DPIA R2). |
| Frequency | On each request a member of staff makes, at a pilot school only |
| Volume | **[FILL after pilot sizing]**, capped by the school's monthly token budget |
| Retention at importer | Observed organisation default: 30 days; zero retention not enabled (`virgo-assistant-pilot-review-packet.md` §5a) |
| Onward transfer | **[FILL from Anthropic's sub-processor list]** |

## 2. Is there an adequacy basis?

**None that this draft knows of.** It found no NDPC adequacy decision covering
the United States. **[Counsel: confirm against the NDPC's current list.]**

## 3. Available routes and how each fits

| Route | Fit for this processing | Time | Engineering view |
|---|---|---|---|
| **A. Explicit, informed consent of the data subject** | **Weak.** The people whose data may cross the border incidentally (pupils, parents) are not the ones typing. Staff can consent for their own data only. Collecting parents' consent for whatever staff might mention is possible in principle but hard to make specific and informed. | Fast for staff; slow and uncertain for parents | Counsel to decide whether it can carry the incidental data at all |
| **B. Contractual safeguards (standard contractual clauses or equivalent) with NDPC approval, plus this assessment** | **Strongest fit** for an ongoing processor relationship | **Unknown; NDPC turnaround weeks to months** | Needs Anthropic's agreement to the clauses or a mapping of its DPA onto them |
| **C. Another basis the Act allows** (for example, necessity for a contract with the data subject) | Probably poor: staff typing a child's name is not necessary to any contract with the child | | Listed for completeness |
| **D. Change the design so no personal data can cross** | Would remove the transfer question. It would need a design that never sends request text, which loses free-text understanding, the feature's purpose. | | The non-AI panel already exists as this option |

**Engineering recommendation for counsel to test:**
- **Route B** for the pilot.
- **Route A** as a supplement for staff, who are told and agree in the panel.
- **A parent notice** under whichever basis counsel settles for the incidental
  children's data.

## 4. Laws and practices in the importer's country

For counsel; listed so they are assessed, not as conclusions:

- **Government access:** US surveillance law (FISA section 702, Executive
  Order 12333) and the CLOUD Act. Assess whether short-lived, low-volume
  administrative text from a Nigerian school is realistically in scope.
- **Provider commitments:** Anthropic's Commercial Terms and DPA, and any
  transparency reporting on government requests. **[FILL: versions and
  dates]**
- **Remedies** available to Nigerian data subjects.

## 5. Supplementary measures

| Measure | Status |
|---|---|
| Minimisation: tools never return names, contacts, money or ids; roster names replaced; detectors on every turn | In place, tested |
| No storage by the exporter of request or reply text | In place, tested |
| Encryption in transit (HTTPS to the API) | In place |
| Zero data retention at the importer | **Not in place.** Ask Anthropic; may need a business organisation. |
| Training opt-out under commercial terms | **To confirm** for the production key's organisation |
| Per-school switch, platform kill switch, monthly budget | In place |
| Pilot limited to one school, with stop conditions | Process in place |
| Sensitive-topic warning before sending | Proposed (DPIA §5) |

## 6. Facts the owner must supply

These come from the Anthropic Console and the account's agreements, without
pasting any key:

1. The production API key's organisation is the one in the packet: match it by
   key name and creation date.
2. The Commercial Terms and DPA versions accepted, with dates.
3. Processing and storage regions, and any regional options.
4. The sub-processor list and how changes are notified.
5. Training and feedback settings, and their history.
6. Whether zero data retention is available, and on what account type.

## 7. Conclusion

**[FILL by counsel]:** route chosen; whether NDPC approval is sought and when;
conditions; review date.

| Role | Name | Decision | Date |
|---|---|---|---|
| Counsel | | | |
| SchoolKit owner | | | |

---

## 8. Transfer B: Smart Student Import

| Item | Detail |
|---|---|
| Data | One photo of a register page per request. Model output: names, gender, date of birth, admission number, class, guardian's name and phone. |
| Personal data | **Intended. It is the payload.** Children's identity and their guardians' contact details. |
| Status | **Happening now**, at every school whose owner or admin has accepted the first-use notice |
| Volume so far | **[FILL from Super-admin → Smart Import beta results]** |
| Retention at importer | As §1: 30-day organisation default observed |
| Retention at exporter | Photo: none. Extracted rows: kept in `import_jobs.preview_snapshot` until the job is deleted (DPIA Part B, F1). |

### How the routes in §3 fit Transfer B

- **A. Consent:** stronger than for the assistant, because the data is known
  in advance. But the agreement collected is the **school's**, not the
  parents'. It names neither the provider nor the country. Counsel to decide
  whether it can be explicit and informed, and whose consent is needed.
- **B. Contractual safeguards with NDPC approval:** the same fit as for the
  assistant, and one agreement could cover both transfers.
- **D. Avoiding the transfer:** CSV import and typing already exist.
  Reading registers inside Nigeria would need a provider or model hosted
  there; not assessed.

### Question specific to Transfer B

The transfer is already running. Counsel should say whether it may continue
while the assessment and any NDPC approval are pending, or should pause.
Owner's options:
- leave it as is;
- pause for schools that have not yet scanned;
- pause for every school, using each school's switch or `AI_ENABLED`.
