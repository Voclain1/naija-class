# Paystack setup — staging and production

Run these steps when provisioning a new environment that needs Paystack integration
(slice 8 onward). Paystack test keys and live keys are different credentials;
**staging must always use test keys**.

---

## 1. Obtain keys

Log in to [dashboard.paystack.com](https://dashboard.paystack.com) under the
school's account. Navigate to **Settings → API Keys & Webhooks**.

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

## 5. Local development

Local dev does not receive Paystack webhooks directly. Use one of:

- **Paystack's webhook simulator** (dashboard → API Keys → Send Test Event) pointing
  at an ngrok tunnel: `ngrok http 4000`, then set the webhook URL to the ngrok URL.
- **`GET /payments/paystack/verify/:reference`** — trigger the self-heal path manually
  after completing a sandbox checkout. This is the recommended local test flow.

The API server does NOT need to be internet-accessible for the `init` and `verify`
endpoints; only the webhook endpoint requires inbound connectivity.
