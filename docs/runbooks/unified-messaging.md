# Unified messaging rollout

Paid payment confirmations, school-owned Meta signup, delivery webhooks and
wallet checkout have explicit switches that default to off. The external
schools' WhatsApp path accepts school-owned connections only. Keep the
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
| Meta webhook | `https://api.schoolkit.ng/api/v1/webhooks/meta`. Registered in the API and off by default. Set up in rehearsal first using the steps below. |
| Termii delivery | Verify the current signed delivery contract with Termii before registering any callback. Confirm the transactional DND route, sender approval and account-specific unit prices. |
| Credentials | Add new credentials only to the server-side VPS API env file when the caller and runbook are ready. Keep existing `WHATSAPP_*` and `TERMII_*` values private. |

The VPS configuration serves the API under `https://api.schoolkit.ng/api/v1`.
Public checks returned HTTP 200 for API health, `https://virgo.schoolkit.ng/parents/login`
and `https://virgo.schoolkit.ng/staff/login`. The platform administration
route `https://app.schoolkit.ng/staff/super-admin` redirects to
`/staff/super-admin/login`, which also returned 200. These checks verified
unauthenticated routing. The setup call still uses its existing internal
alert rail.

## Meta callback rehearsal

1. Apply the additive `20261224120000_meta_webhook_inbox` migration. It adds
   provider status columns to the existing notification journal, a provider
   account directory and a tenant-isolated status inbox. Keep the changes
   in place when rolling back the application image.
2. Under operating authorization, independently verify the WABA and phone
   ownership through Meta before provisioning a binding in
   `messaging_meta_accounts`. Populate the school ID, WABA ID and Meta
   phone-number ID under the migration role for rehearsal. The runtime role
   cannot insert or update bindings. The current directory supports one
   exclusive phone binding per school and does not route a shared sender.
3. In the rehearsal VPS API environment file, configure
   `MESSAGING_META_APP_SECRET` and an independent random
   `MESSAGING_META_VERIFY_TOKEN`. Use the same verify token in the Meta
   dashboard, choose the callback URL under the rehearsal API host, and
   subscribe the verified WABA to `messages`. Set
   `MESSAGING_META_WEBHOOK_ENABLED=on` for the rehearsal and confirm the
   challenge. Protect the verify token from proxy/access logs.
4. Verify that a signed status is durably recorded before acknowledgment,
   the worker runs under each tenant scope, and repeated or reordered
   events do not regress a delivery. Verify the 403 for a bad signature
   and that an unbound account cannot create a tenant record.
5. Keep the production switch off until sender authorization and launch
   gates are satisfied. Set it back to `off` to stop callback processing
   and leave the journal intact for reconciliation.

The callback handles delivery statuses and the explicit WhatsApp consent
and STOP commands. General conversation handling and retention automation
remain open. The Termii callback is independently gated. No callback
triggers SMS fallback. Unmatched authenticated statuses remain in the inbox until
a corresponding provider reference is recorded on the notification.

## Template verification

The approval state of the listed tenant variants is **unknown**. Confirm
the language code, Meta category, approved component schema, ordered
body variables and button indexes on the actual sending WABA. A provider
submission or an approval on another WABA cannot satisfy this check.

| Template | Language, category and ordered body | Button to verify |
| --- | --- | --- |
| `fee_payment_reminder` | Unverified on the sending WABA | Dynamic Paystack request code |
| `fee_payment_confirmation` | Unverified on the sending WABA | Verify against submitted components |
| `fee_invoice_issued` | Unverified on the sending WABA | Dynamic Paystack request code |
| `fee_payment_overdue` | Unverified on the sending WABA | Dynamic Paystack request code |
| `guardian_invitation` | Unverified on the sending WABA | Verify against submitted components |
| `student_absence_alert` | Unverified on the sending WABA | Verify against submitted components |
| `examination_notification` | Unverified on the sending WABA | Verify against submitted components |
| `results_released` | Unverified on the sending WABA | Verify against submitted components |
| `setup_call_booked` | Existing internal rail uses `en`, Utility, with school, Lagos slot, contact name and contact phone in that order | Existing internal payload has a body only |

The internal template details come from the existing sender and its
[configuration guide](whatsapp-alerts.md). Verify them separately before
considering any account binding or rollout change.

## Wallet checkout and campaign scheduling

Keep `MESSAGING_TOP_UPS_ENABLED=off` until sending and financial
reconciliation are ready. For a Paystack test-mode rehearsal, configure
`MESSAGING_TOP_UP_MIN_KOBO` and `MESSAGING_TOP_UP_MAX_KOBO` as integer kobo
and use the existing signed callback
`https://api.schoolkit.ng/api/v1/payments/paystack/webhook` on the appropriate
test host. Keep wallet funds in the platform account, separate from school
fee splits. Replay the successful webhook and verify it creates one credit.
Turning the checkout switch off blocks new checkouts and still honors
valid payment callbacks for an outstanding top-up.

The wallet reservation function requires explicit school and platform spending
authorization. The daily caps count all reservations during the Lagos day,
including released ones. A release restores wallet credit immediately. It
does not reopen that day's allowance. There is no API to set policy in this
change. Keep top-ups disabled for real schools until reconciliation and spend
configuration can be managed.

Set the optional `MESSAGING_REMINDER_SMS_RATES` to a JSON list of verified,
versioned Termii rate rows if staff need a quote. Each row carries the
provider's amount in its smallest unit, an FX ratio, tax and margin in basis
points, evidence and an effective interval. The preview totals
eligible potential SMS fallback segments. A quote does not activate a channel
or reserve wallet funds for an existing SMS rail.

## App Review

Use the separate [App Review runbook](meta-app-review.md) for the messaging
and management demonstrations.

## Termii account-specific verification

The staged callback is `https://api.schoolkit.ng/api/v1/webhooks/termii/<accountId>`.
Keep `MESSAGING_TERMII_REPORTS_ENABLED=off` until Termii confirms the
wire format for the specific account. Its Events and Reports page specifies
SHA-512. The QA report identifies conflicting SHA-256 guidance, so a
production profile must explicitly record the confirmed algorithm, header,
hex encoding, and verification evidence. Do not test signatures by trying
both algorithms.

Store `MESSAGING_TERMII_REPORT_PROFILES` as a private API environment JSON
array with one exclusive account ID, school ID, signing secret, signature
header, algorithm, verification reference and verification time per account.
The route ignores any tenant field in the payload. Use a separately scoped
credential per profile. Signed statuses update only matching SMS delivery
records. Carrier delivery alone cannot justify settling or releasing a
financial reservation.

[Termii Events and Reports](https://developers.termii.com/events-and-reports)

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

The finance campaign and wallet changes share the existing notification
journal. Committed Paystack payments can queue a paid confirmation for an
explicitly configured school and channel. A prepared per-school profile
pins a rate version, effective dates and reviewer evidence. Meta status and
category are checked immediately before dispatch and a reclassified
template stays blocked until reviewed. School-owned Meta billing does not
use wallet funds. An uncertain Termii attempt keeps its reservation until a
platform operator checks provider billing evidence and reconciles it.

School owners can initiate and complete school-owned Embedded Signup, then
disconnect and retry revocation. Guardians grant consent by sending the
one-time challenge from their recorded phone and can withdraw in the
portal or via STOP. Disconnection removes webhook routing and invalidates
existing grants. The original internal sender still defaults to Graph
v21.0 and honors `WHATSAPP_GRAPH_VERSION`. Tenant signup requires its own
explicit `MESSAGING_META_GRAPH_VERSION` and does not reuse internal tokens.

New paid payment profiles are supplied through
`MESSAGING_PAID_PAYMENT_PROFILES`. Each contains the school's ID, one
channel, a daily allowance and rate entries. A Meta profile contains its
school's reviewed payment-confirmation template and exact provider variant.
A managed SMS profile requires a Termii account ID, the existing school SMS
preference and a funded wallet. `MESSAGING_PAID_PLATFORM_DAILY_KOBO` caps
SchoolKit-managed SMS. Keep `MESSAGING_PAID_ENABLED=off` in production.

Remaining engineering includes broader automated event hooks, an admin
rate and template management surface, account-update and phone-registration
lifecycle handling, automated billing reconciliation, and general inbound
conversation handling. Current template mappings for other flows remain
unverified. Separately, real rollout requires Meta approvals and verified
production templates, display name and billing, confirmed provider rates,
and account-specific Termii signature evidence.
