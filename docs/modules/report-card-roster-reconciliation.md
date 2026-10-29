# Report-card roster reconciliation

## Purpose
The October 28 owner/teacher audit found four enrolled students but only three
report cards. Once cards existed, the board offered no rebuild action or explanation.

## Minimum to ship
- The tenant- and role-scoped board response includes the enrolled count and the
  students without a card in this class and term. Status filters must not create
  false missing-student warnings.
- Show the roster count and named missing students to managers and form teachers.
- Owners/admins can rebuild an existing fully DRAFT class using the existing
  audited build endpoint. Explain that scores/attendance refresh and comments stay.
- Advanced cards require the existing owner-only, reasoned reopen, including
  SUBJECT_REVIEWED. Never silently reopen, delete historical cards, or release.
- Refuse a build that would overwrite an enrolled student's advanced card in
  another class after a transfer; reopen the original class first.
- Teachers see actionable guidance to contact an administrator/owner.

## Data/API
No schema, migration, permissions, or new mutation endpoint. Add `roster` to
GET /report-cards: enrolledCount and missingStudents (existing student bio DTO).
The status filter applies to displayed cards only, not roster reconciliation.

## Acceptance
1. Build one pupil, enroll another: board names only the missing pupil. Rebuild
   adds their card, preserves the first card ID/comments, and is idempotent.
2. WITHDRAWN pupils are not reported as missing. Other schools/terms/classes do
   not contribute. A status filter does not misclassify existing cards.
3. Fully draft boards expose rebuild to managers only. Advanced boards explain
   reopen; no direct build is available and the API still rejects advanced builds.
4. Reopen remains owner-only, requires a reason, and keeps render-in-flight guards.
5. Existing historical cards are retained. No automatic workflow transitions are
   introduced beyond the build endpoint's existing subject-review cascade.
