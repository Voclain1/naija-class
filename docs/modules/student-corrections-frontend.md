# Reviewed student corrections — staff web

Frontend chunk, 2026-11-09. Backend contract: `student-corrections.md` (#520).
No backend implementation, permission, feature enablement or AI-policy change.

## Flow

The roster's **Review record corrections** link opens `/students/corrections`.
The page requires owner/admin plus student.read and student.update, matching
the backend's two gates. A feature-off notice links back to existing individual
Edit actions. A failed availability read offers retry; it never performs an
unreviewed bulk PATCH fallback.

Search the existing roster (20 results per page), add individual students or
loaded search results, and edit a batch of at most 100. Records are identified
by id; names and admission numbers help the staff member check the selection.
Search responses are ignored after a later search or account change.

Only first/middle/last name, DOB, gender and email are editable. Inputs are
initialised from the selected record; unaffected fields are omitted. Clearing a
recorded middle name or email requires its explicit checkbox. Blank optional
inputs never silently remove data. Client validation uses the shared six-field
patch schema, including real calendar dates. The server remains authoritative
for record existence, future dates, warnings and stale values.

**Review record changes** prepares a server proposal, not a write to students.
The dialog renders its named before/after values, CLEAR/SAME/SET actions, counts,
errors and warnings. All of these values come from the proposal response.
Confirm needs an unchecked-by-default acknowledgement and canConfirm. Going
back before confirmation preserves the in-memory editor values. Completion
clears the editor, lists the fields actually changed and links to the records.
Rows with no changes are never counted as rewritten.

## Recovery and privacy

- The same client UUID and immutable body are retained on prepare retries.
- A lost confirmation reads the original proposal. It never prepares another
  batch to recover a possibly committed write.
- A stale/expired/retry conflict needs refresh and another acknowledgement.
  Refresh retries keep their request id. Cleared expired values can only be
  re-prepared from an existing in-memory input; otherwise select the records
  again. Already-confirmed refreshes read the original outcome.
- A status failure blocks cancel, new preparation and another confirmation
  until **Check original review** succeeds. Malformed outcomes are not treated
  as permission to resend.
- The browser address carries only `?review=<proposal id>`, so the same staff
  member can reload the saved preview/outcome even with the feature off. No
  drafted values are put in the address or browser storage. Names used in
  roster search use the existing authorised search API.
- Editor drafts remain only in component memory; leaving before a saved review
  is created loses them. Sign-out/account changes unmount and dispose the
  session, stopping further requests. An in-flight server transaction may still
  complete and must be recovered through its saved review.
- Page and portalled dialog use analytics exclusion and Sentry masking. There
  are no new analytics payloads, model calls, AI logs, invitations or notices.

No admission number, status, placement, guardian, credential, health, behaviour,
grade, finance or deletion operation is exposed here. All keep their own paths.
Metadata retention remains the backend doc's pending owner decision; this UI
adds none.

## Verification

24 focused draft/session tests cover exact patches, explicit clears, invalid
calendar dates, no-change outcomes, identity reuse, stale refresh, lost saves,
requester recovery and disposal. Browser cases exercise real prepare/confirm
endpoints, named diffs, stale records, lost responses/reload with switch off,
phone layout, whole-batch blocking and frontend role visibility. The role
visibility fixture mocks only /auth/me and is not backend authorization proof.
Final-head browser/CI results are recorded in the PR.
