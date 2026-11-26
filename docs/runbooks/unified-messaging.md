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

## Paystack and legacy SMS remediation

Before deploying this branch to an environment that already sends authorized
Termii SMS, configure the verified legacy rate catalogue and an explicit
platform daily ceiling. Before a cutover, inventory each school's existing
SMS producer authorization and set `MESSAGING_LEGACY_SMS_AUTHORIZATIONS`
to a JSON object keyed by school UUID. Each entry has a quoted integer
`dailyKobo` and an explicit `producers` array. Supported producer keys are
`ADMISSION`, `PARENT_MESSAGE`, `GUARDIAN_INVITATION`, `SICKBAY`,
`FEE_REMINDER`, `REMINDER_CAMPAIGN`, `HOSTEL_EXEAT`, and `DISCIPLINE`.
Both `existing-authorized` and the regular legacy release require these
entries, a verified rate and both spending ceilings. Use explicit `off`
only for an intentional shutdown. Boot the candidate in an isolated stack
with mocked providers before swapping the service. A production candidate
with existing Termii credentials and no explicit legacy decision fails
startup. Check tenant readiness, a permitted and denied producer, budget
exhaustion and emergency stop before traffic moves. Roll back the application
to the prior release if readiness differs from the approved inventory.

For Paystack, deploy the inbox migration before running the new worker. Its
public endpoint stays `/api/v1/payments/paystack/webhook`. Configure
`PAYSTACK_WEBHOOK_MODE` as either `test` or `live`, and provide the matching
keyring JSON mapping `whk_` IDs to `whsec_` secrets. Keep the existing API
secret. Legacy-only integrations require explicit, time-boxed authorization
with `PAYSTACK_WEBHOOK_REQUIRE_MODERN=off` and a future
`PAYSTACK_WEBHOOK_LEGACY_REVIEW_BY` date in the candidate preflight before cutover. New configurations
use modern verification by default.
A malformed modern header is rejected even during this transition. During
rotation install both key IDs and remove the retired entry after the overlap
is verified. Before moving existing production integrations to modern-only, confirm modern header delivery and the matching keyring in that environment. Never mix modes on one deployment. The inbox retains
an idempotency key after processing and discards processed payloads. Failed
processing retries with backoff and then leaves a dead letter for investigation.
Keep the inbox and its keys on rollback. Drain outstanding work or record
which events must be replayed before returning to synchronous handling.

The top-up fee estimate is an explicit configuration value. The verified
Paystack processing fee is deducted once from the gross charge before the
ledger credits spendable funds. Unknown fees and mismatches are held for
operator review. The independently gated recovery worker can verify old
outstanding intents when callbacks are missing. Bank settlement statements
still require a separate reconciliation review.

Use `PAYSTACK_PAYMENT_LINK_VALIDITY_MINUTES` to set the local validity of new
links. Older links retain their prior validity behavior. Expired links are
excluded from outbound reminders. Request archival blocks local sharing
while invalidation is pending. Paystack documents archive and due-date
parameters, without establishing that all externally distributed URLs
reject every late payment. A verified payment during invalidation is still
processed or recorded for operator reconciliation. No automatic refund is
issued.

Wallet holds older than 24 hours are escalated for investigation. Passing the
deadline never changes the wallet, sends again, or triggers fallback. Only
verified provider billing or an audited operator decision can resolve a hold.

[Paystack webhook signing](https://paystack.com/docs/payments/webhooks/) ·
[Paystack Payment Requests API](https://paystack.com/docs/api/payment-request/)

### Closing sprint schema and recovery

Apply the four `20270121` migrations before traffic moves. The pre-existing
binary cannot read or write the inbox after the new FORCE RLS policy is
installed. If rollback is necessary, stop all workers, retain the table and
keys, record its outstanding work, and restore the previous inbox policy in a
reviewed forward migration before restarting the older worker. Keep the new
cutoff and exception review columns and preserve their history. Do not reset
processed event identities or reopen already verified wallet credits.

Seven days is the default validity for new payment links. Previously issued
links with no recorded expiry retain their validity unless invalidated.
Superseded expired links are hidden and pending archival. An archived hosted
link may still require financial reconciliation. The verified provider payment
time determines eligibility. Funds received outside the cutoff are unapplied.
Use the audited payment exception queue. Never refund or apply surplus from a
support note or webhook replay alone.


### First production cutover — mandatory pre-merge evidence (PR #563)

The main baseline `61b5c214` has no Paystack webhook inbox and uses synchronous
legacy-signature handling. Muse's specific FORCE RLS incompatibility is with
the intermediate draft `36bb072`, not that main baseline. Verify the actual
running API image, rather than assuming it is main. Do not deploy or use an
intermediate draft image as a rollback target.

The VPS workflow currently migrates before switching images and rewrites
`api.env` from the GitHub `API_ENV_FILE` secret (except the documented two
voice overrides). A setting changed only on the VPS can be overwritten.
The new read-only PR preflight checks the candidate secret's structure
without printing values and inspects running image/schema metadata. It
does not establish provider delivery, backup restorability or SMS capacity.

**Before merge / production authorization:**

1. Obtain green exact-head CI and read-only cutover preflight. Verify the
   live Paystack endpoint remains `/api/v1/payments/paystack/webhook`.
   Choose the authentication path explicitly. For modern-only, confirm actual
   timestamped `Paystack-Signature` delivery with the live signing keyring.
   For an existing account without signing keys, the owner may authorize
   `PAYSTACK_WEBHOOK_MODE=live`, `PAYSTACK_WEBHOOK_REQUIRE_MODERN=off` and
   `PAYSTACK_WEBHOOK_LEGACY_REVIEW_BY=YYYY-MM-DD` (UTC, no more than 31 days
   ahead) in the private candidate API configuration. Keep the existing live API
   secret, do not invent a keyring, and confirm actual valid legacy HMAC delivery
   to the VPS. A modern header, if present, still must validate; it never falls
   back to legacy. The review date gates preflight, not running payments:
   investigate migration availability before the date, reauthorize explicitly if
   still unavailable, and switch to modern-only after verified delivery and a
   compatible rollback rehearsal. Legacy signatures have no timestamp;
   persistent event deduplication mitigates repeated processing but is not a
   substitute for timestamp-based freshness. Do not log signing headers,
   secrets, or payment payloads. Confirm the pre-cutover legacy image can
   still receive the provider's signature on rollback; if not, a compatible
   rollback image must be rehearsed first.
2. Review existing school/producer SMS authorization and actual DND unit
   rates/capacity. Choose explicit `off` only if intentional cessation is
   authorized; otherwise use `existing-authorized` with the school/producer
   allowlist, current verified rates and both ceilings. Run permitted,
   denied, exhausted and emergency-stop cases in isolation, with no real
   sends. The presence of a Termii key is not proof of active service.
3. Keep new paid dispatch, checkout/recovery, shared sender, Meta onboarding,
   phone registration, template submission, inbound retention and provider
   report processing off. Preserve existing internal notifications and
   Paystack fee collection credentials. Confirm Fly auto-deploy is disabled.
4. Verify an independently restorable recent backup, the exact old image tag,
   and the rollback configuration. Rehearse the migration and rollback on
   a private clone using fictional data. Confirm health, runtime role,
   existing payment/receipt behavior, queue recovery and RLS.
5. Record the sign-off and schedule a maintenance window. For the first
   cutover, pause automated production deployment using
   `VPS_DEPLOY_ENABLED=false` until ready. The added independent guard
   requires `UNIFIED_MESSAGING_CUTOVER_APPROVED=true` before a live deploy
   may proceed; leave it unset until steps 1–4 are evidenced. Do not turn
   this into a bypass for incomplete evidence.

**During the approved window:** stop/drain the old API and background workers
before the first migration; keep Postgres and Redis running. Requests
during the window must receive a retryable error, not a synthetic success.
Verify no active webhook processing remains; record pending payment
references in the secure operator journal. Apply migrations, boot the
candidate with new paid gates off, and verify health and DB role before
returning traffic. Verify signed webhook receipt, asynchronous completion,
invoice allocation, receipts, existing email and internal alerts, and
approved legacy SMS readiness. Review pending/dead-letter counts, payment
exceptions and provider reconciliation. Do not initiate live test payments
without separate owner authorization.

**Rollback:** stop candidate workers first, prevent new webhook acceptance,
retain all database changes, inbox payloads and dedupe keys, and inspect
outstanding inbox work. The pre-inbox main image does not read the inbox;
therefore RLS need not be relaxed for that target. Reconcile every accepted
but unprocessed event via an audited, rehearsed compatible worker or
provider verification; old synchronous code will not pick up those rows.
Never delete or reset the inbox or restore an earlier database over newer
payments. Restore the exact previous image and compatible config and
verify its legacy webhook signature delivery before resuming. If recovery
requires an intermediate inbox image, stop and obtain a separate reviewed
compatibility plan; do not disable FORCE RLS in live production as an
automatic rollback step. The existing generic deploy script does not
implement a traffic drain or this financial recovery procedure. Use the
approved controlled procedure rather than claiming automatic rollback is
sufficient. First-cutover rehearsal and live provider confirmation remain
unverified until evidence is recorded.

### Batch 2 recovery and backup gates

The verified production baseline `61b5c214` predates both allocated payments
and the inbox. Its invoice, refund and receipt calculations sum the gross
amount. After a candidate payment records a different allocation, bringing
that API back for writes can corrupt the invoice balance and installment
state. In the fixture a ₦40 allocated payment plus ₦70 of unapplied funds
produced ₦110 under the old calculation and ₦40 under the candidate.
Preserve gross collections, allocated amounts, receipts, audit rows and
exception records without rewriting those amounts for the older image.

Use `93cc9eebf50ec06be72c3b565698f1c77907d0d9` as the minimum recovery
**source** until another release is tested. Build, pin and stage its actual
API and worker image digests separately from the live deployment. Verify
legacy signature compatibility, health, finance writes and inbox processing
against a representative migrated fixture. An image identifier and a
successful image rehearsal are both required before clearance. The old
release is not an automatic recovery target. Recovery from the first
deployment must use the pinned allocation-compatible release or remain in
maintenance while fixing forward.

In rehearsal, have the candidate accept a signed fictional event, stop it
before the next worker claim, and return 503 on webhook ingress. Preserve the
database, FORCE RLS policies, inbox identities and leases. Start the
allocation-compatible recovery API and worker against the same database,
wait for the lease to expire or review its dead-letter state, use the
audited replay endpoint where needed, and submit the same signed event
again. Verify one financial effect, one receipt, unchanged gross and
allocated totals on duplicate delivery, preserved exception and audit
records, and no cross-tenant inbox exposure. Resume ingress after that
evidence. Never restore a pre-cutover snapshot over newer transactions.

The owner restored a protected 2.2 MB production dump in an isolated
PostgreSQL 18 and pgvector 0.8.7 container in seven seconds on 25 November
2026. This was a manual restore. Nightly object-storage dumps and WAL-G
backups were absent. Before cutover, check the running `ops` container's cron
and backup output, the presence and permissions of `backup.env`, and
credential identity, bucket/prefix permissions and endpoint access using
redacted checks. Inspect `pg_stat_archiver` and actual WAL object inventory
separately from the base backup list. The shipping workflow previously
overwrote the VPS backup environment even if the secret was empty. **Since 2026-11-26** `deploy-vps.yml` never overwrites a server's `backup.env` (the secret only
bootstraps an empty server), `ops-tools/backup_env.py` rejects missing, empty and duplicate required
settings, and `cutover.sh` refuses to run unless the owner exports
`UNIFIED_MESSAGING_CUTOVER_APPROVED=true` for that one command and holds an unexpired authorisation
bound to the exact head and manifest. See `docs/runbooks/batch2-acceptance-and-batch3.md`.

After authorization, prove a scheduled run produced a dump, read-back
checksum marker, WAL-G base backup, archived WAL and success heartbeat.
Use a network-isolated restore of that off-site artifact with no production
volumes and verify aggregate integrity. The scheduled restore script still
uses a scratch database on its configured instance. Run it solely against an
approved isolated instance for this clearance, and use a separate test
instance for WAL-G point-in-time recovery. Retain the verified database-tool
image digest and exact production PostgreSQL major; an untagged or missing
local tag is not a recovery plan. Deployment no longer prunes host images.

#### Cloudflare R2 backup transport

The backup image pins upstream rclone v1.76.0 for Linux amd64 and verifies
the upstream SHA-256 during the image build. The backup remote uses the
Cloudflare provider, region auto, no bucket creation check, and no
post-upload HEAD. Existing access keys and the configured endpoint remain
unchanged. The independent download and SHA-256 comparison still run
before the completed dump becomes eligible for restoration. The scheduled
restore also independently verifies the marker against the retrieved dump.
These rclone options do not change the WAL-G environment.

The owner proved these options with a disposable R2 object using the
previously installed rclone. Validate the pinned binary with a scheduled
database backup and isolated restore before clearance. Verify a WAL-G
base backup and replay archived WAL in a separate recovery exercise.

#### Hosted release images and independent backup rollout

The PR #563 `batch2-images` workflow publishes API candidate, allocation-aware
recovery API, and PostgreSQL 18 backup tooling images to the existing GHCR
namespace with run-specific tags. Use the digest references in the
`batch2-image-digests` artifact. The build uses the repository package token.
The rehearsal creates fictional credentials and an internal Docker network.
It does not SSH to the VPS. Capture the rehearsal result alongside the digests.
The generic VPS workflow and host deployment script are rehearsal-only; the production
procedure is `infra/vps/ops-tools/cutover.sh` (`docs/runbooks/batch2-acceptance-and-batch3.md`).
Owner approval alone does not re-enable their migration-first and automatic
rollback paths on live systems.

After explicit owner authorization, record the current `ops` and Postgres
container IDs, current ops image, and protected configuration metadata.
Pull the reviewed backup digest. Add a separate Compose override defining
only `services.ops.image` as that immutable digest. Use the existing project
and env file and that override to recreate just ops:

```sh
docker compose --env-file deploy.env -f docker-compose.yml -f backup-ops.override.yml up -d --no-deps --no-build --pull never ops
```

Check that the Postgres ID and start time are unchanged. Keep `backup.env`
and credentials untouched. If ops fails, restore the recorded ops image
using the same override and scoped command. Do not recreate Postgres to
update rclone. Keep the override in the owner-approved operations
configuration so later releases do not accidentally replace the pinned ops
image. Verify cron output and a scheduled completed dump marker, independently
download and check its checksum, then restore into a private scratch instance.
Confirm retention and the missed-backup alert with the monitoring operator.
For WAL-G, inspect archiver health and archived objects, take a base backup,
and exercise PITR in an isolated instance using the correct PostgreSQL major
and existing least-privilege storage configuration. Verify a transaction on
each side of the chosen restore target.

#### Authorized scheduler and physical recovery rehearsal

Download the reviewed `infra/vps/batch2-backup-recovery.sh` from PR #563
without changing its contents. Place it in the approved VPS operations
directory or another operator-owned location. Run it from the directory
containing the production Compose and env files, away from the 01:30 UTC
backup window. The host needs Docker Compose, Python 3, flock and free
storage for the base and WAL. Use the named verified digest.

```sh
cd /opt/school-kit
bash /path/to/batch2-backup-recovery.sh activate
# After the next scheduled 01:30 UTC run:
bash /path/to/batch2-backup-recovery.sh verify-night
```

The activation writes two WAL-only restore markers on the existing cluster.
It makes no application record changes. It stages WAL locally and checks a
paused replay between the markers on a networkless clone, then removes the
clone and temporary WAL. Stop if the verified base inventory or timeline
changed, or if remote WAL cannot be fetched. The clone is never promoted.

The script retains the original ops container, disables its restart policy
and stops it before starting the separate digest-pinned scheduler. The
verified tooling is retained under a local fallback tag as well as its GHCR
digest. The persistent Compose override must accompany future ops-specific
Compose commands. Do not run a generic Compose operation that starts the
old service or removes the retained container as an orphan. If the
replacement fails and the old image cannot restart, leave the old container
intact and use the tagged fallback through the pinned override only after
confirming there is no active scheduler.

For Batch 2 acceptance, save the script's sanitized output, and match the
scheduled dump marker and WAL-G base backup to the same cron window. Use the
monitoring service to verify the success timestamp and missed-heartbeat
notification or its test-delivery record. Verify that every retained base
still has the WAL required for the agreed recovery window before approving
any change to retention. Do not change the production database or use a
forced backup or heartbeat ping as proof of cron scheduling. The second
command performs independent download, checksum and archive-catalog
validation of the scheduled dump. The separately verified off-site restore
and the new named-target physical rehearsal are distinct evidence.
