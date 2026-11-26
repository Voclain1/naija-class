# 2026-11-26 — Instalment checkout

Draft PR #567 extracts allocation and link lifecycle changes from #563. Keep the
finance migrations under their original names. The mixed reconciliation migration
now contains the finance DDL alone. When #563 is reconciled, preserve the exact
finance file and move its two wallet columns to a wallet-only migration.

Draft PR #566 uses the same settlement function for instalment checkout and
retains the invoice-level checkout. A nullable target preserves legacy inputs.
Test data use a Paystack stub. Request policies default to disabled. Do not
deploy either branch until exact-head CI and financial and visual acceptance are
reviewed. Automated VPS deployment was observed disabled.
