# Paystack setup — staging and production

Run these steps when provisioning a new environment that needs Paystack integration
(slice 8 onward). Paystack test keys and live keys are different credentials;
**staging must always use test keys**.

---

## 1. Obtain keys

Log in to [dashboard.paystack.com](https://dashboard.paystack.com) under
**SchoolKit's own** Paystack account — there is one platform integration, not
one per school. (Corrected 2026-08-15: this line previously said "the school's
account", a leftover single-school framing. Schools never hold Paystack
credentials; they receive a subaccount code created on this integration. See
`docs/modules/paystack-assisted-setup.md`.) Navigate to **Settings → API Keys
& Webhooks**.

| Key | Where to use |
|---|---|
| **Test Secret Key** (`sk_test_...`) | Staging Fly app only |
| **Test Public Key** (`pk_test_...`) | Staging / local frontend only |
| **Live Secret Key** (`sk_live_...`) | Production Fly app only |
| **Live Public Key** (`pk_live_...`) | Production frontend only |

Never commit either key to the repository. Never set a live key on the staging app.

---

## 2. Set secrets on Fly.io

### Staging

```bash
flyctl secrets set --app school-kit-api-staging \
  PAYSTACK_SECRET_KEY="sk_test_..." \
  PAYSTACK_PUBLIC_KEY="pk_test_..."
```

Verify:

```bash
flyctl secrets list --app school-kit-api-staging
```

`PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` should appear (values are
redacted in the list output).

### Production

```bash
flyctl secrets set --app school-kit-api \
  PAYSTACK_SECRET_KEY="sk_live_..." \
  PAYSTACK_PUBLIC_KEY="pk_live_..."
```

**Do not mix test and live keys.** The API checks for `PAYSTACK_SECRET_KEY` at
startup and throws if the variable is absent — the app will not start.

---

## 3. Register the webhook endpoint

In the Paystack dashboard under **Settings → API Keys & Webhooks → Webhook URL**,
set:

| Environment | Webhook URL |
|---|---|
| Staging | `https://school-kit-api-staging.fly.dev/api/v1/payments/paystack/webhook` |
| Production | `https://school-kit-api.fly.dev/api/v1/payments/paystack/webhook` |

Paystack sends a POST with `x-paystack-signature` (HMAC-SHA512 of the raw body
using the secret key). The API verifies this before processing; unsigned requests
are rejected with 401.

Events to enable: **`charge.success`** and **`charge.failed`** at minimum.

---

## 4. Test the integration

Use [Paystack's test card numbers](https://paystack.com/docs/payments/test-payments/)
to complete a test payment in the staging environment.

After a successful test payment:
1. The webhook delivers `charge.success` to the staging endpoint.
2. The matching `Payment` row transitions from `PENDING` → `SUCCESS`.
3. The `Invoice.totalPaid` is recomputed and `Invoice.status` updates.
4. A receipt HTML is uploaded to R2 (or the filesystem driver in dev).

If the webhook is not delivered (ngrok not running locally, infra restart during
checkout), call `GET /api/v1/payments/paystack/verify/:reference` with a valid
bearer token to self-heal the PENDING payment.

---

## 5. Fulfilling a school's subaccount setup request

Schools cannot create their own subaccount (see §1). They submit banking
details via **Settings → Payments**, which lands in the platform-admin
dashboard's *Pending Paystack setup requests* queue at
`/super-admin/dashboard`.

For each pending request:

1. Click **Reveal details**. This writes a `paystack-setup.reveal` audit row
   every time — it is the only path in the product that returns a school's
   account number, so treat repeated reveals as something you'd have to
   explain.
2. In SchoolKit's Paystack dashboard, **Subaccounts → New Subaccount**. Enter
   the revealed business name, bank, and account number. Paystack resolves the
   account name itself — **if it does not match the name the school gave, stop
   and reject the request with that as the reason** rather than guessing.
3. Copy the resulting `ACCT_…` code into the queue row and click **Mark
   fulfilled**.
4. The API fetch-verifies the subaccount, creates or reconciles the
   deterministic per-school Transaction Split (`percentage: 100`, sole school
   subaccount, school bears Paystack fees), fetches the saved split back, and
   only then atomically stores both codes and enables payments. Any mismatch
   leaves the request pending and the school disabled.

The school no longer pastes a code after fulfilment. Replacing or clearing a
subaccount disables payments and clears its split code; a new assisted-setup
fulfilment is required before re-enabling.

### Backfill for schools configured before `paystack_split_code`

1. Run `pnpm db:census-paystack-splits`. This is a read-only `DIRECT_URL`
   census and prints opaque school ids only. Review the resulting manifest.
2. Select exactly one pilot school. Dry-run only that id with
   `pnpm api:backfill-paystack-splits -- --school-id <id>`.
3. Apply only that reviewed pilot, passing the same id again as an explicit
   confirmation plus the acting platform admin's tenant and user ids for the
   audit row:
   `pnpm api:backfill-paystack-splits -- --apply --school-id <id>
   --confirm-school-id <same-id> --actor-school-id <operator-tenant-id>
   --actor-user-id <operator-user-id>`.
4. Rerun the same single-school command without `--apply`. It must return
   `already-verified`; this performs a fresh Paystack fetch and validates the
   percentage-100 split, sole expected subaccount and fee bearer independently
   of the database write. Confirm exactly one `paystack-split.backfilled` audit
   row for that school.
5. Smoke the pilot end to end before selecting another school: create and
   reload one durable link, confirm its no-recipient share URL, complete a test
   payment, then verify the Payment row, invoice balance, webhook idempotency,
   link consumption and remote request archival. Stop on any mismatch,
   duplicate credit or unarchived stale amount.
6. Wider rollout is repetition of steps 2–5, one school per invocation and
   with observation between schools. The CLI rejects zero or multiple
   `--school-id` arguments and rejects apply unless `--confirm-school-id`
   exactly matches. There is deliberately no blanket-apply mode.
7. Rerun the census after the final reviewed school. `missingCount` must be
   zero only when the deliberately staged rollout is complete. Database
   eligibility alone is never sufficient; every apply independently verifies
   the stored subaccount and fetch-verifies the resulting Paystack split.

`PAYSTACK_SETUP_EMAIL` must be set for the "a school is waiting" notification
to send. If it is unset, requests still land in the queue — the email is a
nudge, not the mechanism — but nothing will tell you to look.

---

## 6. Local development

Local dev does not receive Paystack webhooks directly. Use one of:

- **Paystack's webhook simulator** (dashboard → API Keys → Send Test Event) pointing
  at an ngrok tunnel: `ngrok http 4000`, then set the webhook URL to the ngrok URL.
- **`GET /payments/paystack/verify/:reference`** — trigger the self-heal path manually
  after completing a sandbox checkout. This is the recommended local test flow.

The API server does NOT need to be internet-accessible for the `init` and `verify`
endpoints; only the webhook endpoint requires inbound connectivity.
