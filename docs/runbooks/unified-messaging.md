# Unified messaging rollout

The new Meta transport and wallet operations are backend foundations. They
have no production caller or configuration switch in this change. Keep the
existing internal WhatsApp alert configuration in its current VPS API env
file. See [Internal WhatsApp alerts](whatsapp-alerts.md).

## VPS and migration

Apply migrations through the existing VPS release procedure. The additive
`20261223120000_messaging_wallet` migration creates an empty wallet journal,
a forced RLS policy, two uniqueness constraints for provider top-ups and
reservation resolutions, and a database trigger that rejects ledger updates
and deletions. It credits no existing school. The application continues to
use `app_user` and the migration uses the direct migration role.

For an application rollback, roll back the image and leave the additive table
in place. If ledger entries exist, preserve the migration and the entries.
School deletion is blocked for a school with any wallet activity. Reconcile
outstanding reservations against the provider before enabling any sender.
Never run local tests against production or give the application the
migration role.

## Provider configuration gates

| Item | Status and action |
| --- | --- |
| Meta app | SchoolKit Messaging API. Business verification, access approvals, production display name and billing need owner confirmation. |
| Embedded Signup | Keep off pending App Review and required access. Store a per-school account binding only after a server-side ownership check. Confirm school-owned and SchoolKit-managed billing independently. |
| Shared sender | Get explicit confirmation from Meta for the intended multi-tenant use before enabling. |
| Template approvals | Verify the account, name, language, category, ordered body fields and button schema for each approved variant. Store the verification with the per-account template. |
| Paystack payment buttons | Confirm `https://paystack.com/pay/{{1}}` for the reminder, invoice issued and overdue templates. Use the bare validated request code for the same invoice as the quoted amount. |
| Meta webhook | Planned URL `https://api.schoolkit.ng/api/v1/webhooks/meta`. No route is registered in this change. Configure it after the challenge handler, durable inbox and tenant routing are deployed. Subscribe verified accounts to the `messages` field. |
| Termii delivery | Verify the current signed delivery contract with Termii before registering any callback. Confirm the transactional DND route, sender approval and account-specific unit prices. |
| Credentials | Add new credentials only to the server-side VPS API env file when the caller and runbook are ready. Keep existing `WHATSAPP_*` and `TERMII_*` values private. This change reads no new production environment variables. |

The VPS configuration serves the API under `https://api.schoolkit.ng/api/v1`.
The source routes for a school-hosted parent login and staff login are
`https://<school>.schoolkit.ng/parents/login` and
`https://<school>.schoolkit.ng/staff/login`. The platform administration
surface is `https://app.schoolkit.ng/staff/super-admin`. Confirm live route
resolution during acceptance before using these URLs in any approved copy.
The setup call still uses its existing internal alert rail.

## App Review demonstration checklist

- Demonstrate authorized school initiation, consent, server-side code exchange
  and rejection of WABA or phone identifiers outside the returned business.
- Show account-specific template synchronization, opt-in, opt-out, an approved
  test send, signed status processing, and token rotation and disconnect.
- Show that browser responses, client bundles and logs carry no tokens or
  message or student data intended only for backend processing.
- Demonstrate how school-owned billing avoids debiting the school wallet.

## Virgo Fidelis Montessori School acceptance checklist

- Verify the intended school ID and slug with the owner before any pilot
  configuration. Use fictional guardians, invoices and accounts for rehearsal.
- Preview a class and confirm exclusions for paid, cancelled, planned and
  unlinked recipients. Pay an invoice between the first and second sends and
  confirm the latter is skipped. Part-pay an invoice while creating a link
  and verify the old amount never becomes an active link.
- Before a paid pilot, prove authenticated webhook replay and out-of-order
  events, consent revocation, price and balance limits, queue recovery and
  ambiguous status reconciliation using sandbox providers.
- Obtain separate approval for a production pilot. Keep fixtures and real
  families on separate tenants. Verify the school payment split, receipt and
  existing email, push, SMS and internal setup call paths.

## Implementation status

Implemented here: fresh per-recipient campaign checks, stale Paystack link
protection during creation, Meta template payload construction and raw-body
signature verification, wallet journal and concurrency-safe operations, and
integer cost estimates. The signature helper has no HTTP consumer.

Pending: live template approvals and the account-specific registry, consent
and verified phone lifecycle, webhook endpoints and workers, durable unified
dispatch and delivery reconciliation, spending controls and wallet top-up
checkout/webhooks, automatic finance and school event messaging, Embedded
Signup, and the runtime frontend endpoints. The contract in
[Unified messaging](../modules/unified-messaging.md) describes the intended
surface.
