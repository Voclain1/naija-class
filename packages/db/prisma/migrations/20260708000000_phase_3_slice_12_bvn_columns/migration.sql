-- Phase 3 / Slice 12 — BVN encryption: columns + pgcrypto extension
--
-- BVN (Bank Verification Number) is staff/payroll PII, NOT student or
-- guardian data — schools need it to submit Paystack transfer recipients for
-- salary payments (phase-3.md §4/§7, slice 12 row). It lives on `users`, not
-- `teacher_profiles`: PayrollItem.userId is staff-generic (plain FK, no
-- relation to TeacherProfile), and non-teaching staff (admin, bursar, owner)
-- can be salaried without ever holding a TeacherProfile row (that model is
-- optional and teacher-only).
--
-- bvn_encrypted: pgcrypto ciphertext (pgp_sym_encrypt output). Never queried
--   directly by app code — always via the decrypt_bvn() SECURITY DEFINER
--   wrapper (next migration).
-- bvn_last4: plaintext, display-only. Four digits alone don't reconstruct a
--   BVN, so this is safe to keep unencrypted and lets list/detail views show
--   "•••• •••• 1234 on file" without invoking decryption. Still masked by the
--   Sentry redactor (SENSITIVE_KEY_RE already matches "bvn" as a substring).
--
-- No RLS changes needed — `users` already carries FORCE RLS + tenant_isolation
-- from Phase 0; these are just two new nullable columns on an existing table.
--
-- pgcrypto extension: installed manually via Neon SQL Editor as neondb_owner.
-- Cannot run via migration (requires DATABASE-level CREATE privilege, not
-- table-owner privilege). See docs/runbooks/neon-prod-setup.md for the
-- provisioning step.

ALTER TABLE "users"
  ADD COLUMN "bvn_encrypted" BYTEA,
  ADD COLUMN "bvn_last4"     TEXT;
