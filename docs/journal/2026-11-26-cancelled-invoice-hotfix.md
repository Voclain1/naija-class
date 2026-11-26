# Cancelled invoice regeneration

PR #565 restores the existing Generate Invoices flow for cancelled term
invoices. Generation preserves their IDs and snapshots, prices replacements
from current fees and discounts, and serializes generation per school and term.
Deploy the additive constraint migration before the API. Earlier deployments
remain compatible with the schema. Keep the migration in place on code rollback.
