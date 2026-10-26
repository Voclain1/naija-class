# Runbook: SchoolKit's WhatsApp alerts

The API can send SchoolKit's own team an automatic WhatsApp message, today one
per new setup-call booking (`docs/modules/onboarding-call.md`). It uses Meta's
WhatsApp Cloud API and is **off until the settings below exist**. Until then
bookings still arrive by email (hello@schoolkit.ng), in the platform admin
under **Setup calls**, and from the school's own WhatsApp when they press
**Send to SchoolKit on WhatsApp**.

## 1. Meta (once)

1. **A Meta Business account** at business.facebook.com, verified with
   SchoolKit's business details.
2. **A WhatsApp Business app** in Meta for Developers: create an app, add the
   **WhatsApp** product, and choose the business account.
3. **A sender number.** It sends the alerts and must be registered with the
   WhatsApp Cloud API. A number registered there **can no longer be used in
   the ordinary WhatsApp or WhatsApp Business app**, so do not use
   +234 704 967 7393 if the team still chats on it: use a second number (a
   new SIM is enough). +234 704 967 7393 is where the alerts go.
4. **A message template**, category *Utility*, language *English*:
   - Name: `setup_call_booked`
   - Body: `New setup call: {{1}} on {{2}}. Contact: {{3}}, {{4}}.`
   - Sample values: `Greenfield Academy`, `Tue 28 Oct 2026 at 10:00 am (Lagos)`,
     `Chika Okafor`, `0803 555 0142`.

   Meta approves templates, usually within a day.
5. **A permanent access token:** Business settings → System users → add a
   system user with the app and the WhatsApp account assigned, then **Generate
   token** with `whatsapp_business_messaging`. The temporary token on the app's
   getting-started page expires in a day; do not use it.
6. Note the **Phone number ID** of the sender number (WhatsApp → API Setup). It
   is not the phone number itself.

## 2. The API's settings

On the VPS these go in the **`API_ENV_FILE`** GitHub secret (written to
`api.env` by `deploy-vps.yml`), one `NAME=value` per line:

| Name | Value |
|---|---|
| `WHATSAPP_CLOUD_TOKEN` | the permanent token (secret) |
| `WHATSAPP_PHONE_NUMBER_ID` | the sender's Phone number ID |
| `WHATSAPP_ALERT_TO` | `2347049677393` |
| `WHATSAPP_BOOKING_TEMPLATE` | `setup_call_booked` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `en` (the template's language code) |

Then redeploy the API (re-run **deploy-vps**). Never paste the token anywhere
but the secret.

## 3. Check

Sign up a test school, finish setup, and book a call. Within a minute:
- the email arrives at hello@schoolkit.ng;
- the WhatsApp message arrives on +234 704 967 7393;
- the booking shows under **Setup calls** in the platform admin.

Mark it done, then delete the test school from the platform admin.

If the WhatsApp message does not come, the API log and Sentry say
`WhatsApp alert "onboarding-call-booked" failed: WhatsApp answered <status>`:
- 401: the token is wrong or expired;
- 400 or 404: the template's name or language does not match, or the template
  is not approved yet.

## Turning it off

Remove `WHATSAPP_CLOUD_TOKEN` from `API_ENV_FILE` and redeploy. Nothing else
changes.
