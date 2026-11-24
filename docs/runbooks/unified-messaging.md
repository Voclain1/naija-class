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
2. Use the gated owner Embedded Signup flow to obtain a binding. The server
   verifies the business token and phone membership before subscribing. Its
   runtime directory writes are limited by RLS to the current school. The
   current directory supports one exclusive phone binding per school.
   Use only fictional accounts and test credentials in rehearsal.
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

The callback handles delivery statuses, explicit WhatsApp consent, STOP
and provider offboarding events. General conversation handling and retention automation
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
array with one account ID, signing secret, signature header, algorithm,
verification reference and verification time per account. A central account
can serve many schools. A deprecated school ID in a profile only drains the
older tenant journal. New reports are routed by the exact account and returned
provider message ID. Reports received before send acknowledgement remain in
the account inbox for a later attempt. Duplicate references across schools
remain unrouted. Recipient fields and any supplied school ID are discarded.
Carrier state alone cannot settle or release funds. Termii documents an
optional per-message charge field, but accounts may differ on amount units
and when the charge becomes final. Add the optional `billing` object only
after confirming `currency: "NGN"`, `unit: "KOBO"` or `"NAIRA"`,
the specific terminal `finalStates`, whether `zeroIsFinal`, and the
`contractRef`. The reconciler uses exact decimal strings and holds funds
when charge evidence is missing or malformed. A verified partial charge
returns the unused portion. A conflicting or excessive charge is audited
for operator review. Keep production report processing disabled until
both the signing and billing evidence contracts have been validated.

For platform-funded SMS, set `MESSAGING_LEGACY_SMS_ENABLED=on` only after
authorizing an effective, verified Termii rate in `MESSAGING_LEGACY_SMS_RATES`
and setting `MESSAGING_PAID_PLATFORM_DAILY_KOBO`. The legacy rail and wallet
rail share that ceiling. Legacy SMS conservatively consumes the estimated
segment cost before sending, including an attempt with an uncertain response.
This switch is independent of `MESSAGING_PAID_ENABLED`, which gates school
wallet and paid WhatsApp jobs. Before rollout, check each existing sender
against the approved budget. The audited emergency endpoint can stop either
rail before its next provider request. Requests already in flight cannot be
recalled.

The legacy producer inventory covers admissions alerts, parent inbox alerts,
guardian invitations, sickbay alerts, manual fee reminders, scheduled reminder
campaigns, hostel exeat notices and discipline alerts. All use the same
platform-funded Termii egress guard. Wallet-funded confirmations use a
separate method that requires a committed reserve and one durable send claim.
The authentication implementation uses password, email, and local TOTP flows
without a Termii OTP producer. Legacy attempts currently debit the budget
aggregate and do not carry a per-attempt financial ledger or reference
mapping.


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

School owners separately opt the school into WhatsApp or wallet-backed SMS.
Both settings default off and leave legacy preferences intact.
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
A managed SMS profile requires the Termii account ID matching
`MESSAGING_TERMII_PAID_ACCOUNT_ID`, the existing school SMS preference and a
funded wallet. `MESSAGING_PAID_PLATFORM_DAILY_KOBO` caps wallet-funded
and platform-funded SMS together. Keep `MESSAGING_PAID_ENABLED=off` in production.

Paid jobs for class and supplementary invoice issuance, new and replacement
guardian invitations, attendance marking, CBT publication, and free results
release commit with the business record. This covers the composed invoice
creation methods. Attendance keeps its correction window. Reviewed and
scheduled fee reminders continue to use the campaign journal. Invoice link sends require a
matching current outstanding amount on one payable invoice. A WhatsApp
invitation never carries its bearer link. Guardians without verified
consent still use the existing invitation channels.

School-owned inbound history is off by default. A rehearsal school requires
`MESSAGING_META_INBOUND_HISTORY_ENABLED=on`, a separate base64-encoded 32-byte
`MESSAGING_META_INBOUND_HISTORY_KEY`, and a school-specific retention entry
in the `MESSAGING_META_INBOUND_RETENTION_DAYS` JSON map (1–90 days).
Existing authenticated consent is required to associate an inbound text with
exactly one guardian. Consent commands, STOP, media, unsupported attachments
and standalone six-digit codes are excluded. Viewing history requires a
school owner, creates an audit event, and only returns current, unexpired
rows. An expiry worker deletes old ciphertext even when ingestion is
disabled. The endpoint currently shows the latest 50 messages per guardian.


### Engineering still open

- Unknown outcomes without a provider reference need operator evidence.
  Carrier states and account balance snapshots are insufficient for
  per-send settlement. The per-school
  reconciliation report shows pending, discrepant, settled and released
  holds. An operator can settle a documented partial charge, release with
  documented zero charge, or record an over-reservation discrepancy without
  changing the hold.
- Full Meta account event handling and secondary credential lifecycle operations.
  Reconnect through a new Embedded Signup grant after revoking the former
  credential. Phone registration and template submission have separate
  default-off flags, `MESSAGING_META_PHONE_REGISTRATION_ENABLED` and
  `MESSAGING_META_TEMPLATE_SUBMISSION_ENABLED`. A submitted template
  still needs an independent variant approval and dispatch review.
- Provider release attestations remain in the private VPS configuration.
  Price catalogues, template reviews, provider activation, emergency
  revisions and spending limits use append-only platform API revisions.
  Provider activation cannot bypass deployment release flags.
  An operator can lower a configured ceiling, set it to zero, or remove the
  override. Operator limits cannot exceed privately configured maxima.

### External rollout dependencies

Meta verification, Advanced Access and App Review remain external. Confirm
school-owned billing and display names, approved templates and exact
components on the sending WABAs, official rates and version dates, and
Termii's account-specific webhook signing contract. Shared SchoolKit-branded
tenant delivery is disabled. The existing internal alert is separate.
