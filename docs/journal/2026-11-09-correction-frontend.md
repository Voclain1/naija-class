# 2026-11-09 — reviewed student corrections frontend

Verified Claude's #519 (campaigns) and #520 (corrections) merged. Kept work in
complete frontend workflow chunks: campaign integration in #518; this branch
`frontend/student-correction-workflow` implements the record-correction editor.

Built roster entry, search/selection, up to 100 edited records, six permitted
fields only, explicit optional clears, server before/after review, mandatory
human confirmation, stale refresh, saved review links and lost-response outcome
recovery. Existing individual Edit/PATCH path is unchanged; no unreviewed bulk
fallback is introduced. No backend or switch changes, no model or messages.

24 focused unit cases pass; the combined web suite passes 688 tests / 88 files
after merging #518. Web lint/typecheck and E2E typecheck are checked again on
the combined branch.
Seven browser journeys added; real browser/API execution awaits CI. Drafts are
in memory only; saved proposal ids (not values) go into the browser address.
