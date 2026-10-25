# Paying a fee from the app: the first real test

Written 2026-10-24. Payments already work on the parents' website; this checks
the same payment from the parent app, end to end, once. Clears the "Paystack
mobile checkout has never been round-tripped" item in `docs/deferred.md`.

How it works (`apps/mobile/src/lib/payments/checkout.ts`): the app asks the
API to start a payment with `returnTo: "app"`, opens Paystack in an in-app
browser, and Paystack sends the parent to
`portal.schoolkit.ng/payments/callback/app`, which hands them back to the app
(`schoolkit://payments/callback`). The app then asks the API whether the
payment went through. The webhook is what records the payment; the return to
the app is only a convenience.

## 1. Build the test app (no computer needed)

1. GitHub → the `naija-class` repository → **Actions** → **Build the app** →
   **Run workflow**.
2. Profile: **preview**. Platform: **android**. Run it.
3. When it finishes, open expo.dev → `voclains-team/school-kit` → the new
   build, and open its install link **on the phone**. Install the APK (Android
   asks to allow installs from the browser once).

The preview build talks to the live API (`api.schoolkit.ng`), so it sees real
schools and takes real money. Use your own test school.

`EXPO_TOKEN` must be set as a repository secret (see
`docs/runbooks/mobile-eas-setup.md` §1a). Never paste it into a chat.

## 2. Prepare a small invoice

On the staff website, at your test school:

1. A test student with **your own** phone or email on their parent record.
2. A small fee, ₦100, billed to that student this term.
3. Invite that parent to the parent portal and accept the invitation, so the
   parent has a password.

## 3. Pay from the app

1. Open the app and sign in as that parent.
2. Open the child → the ₦100 invoice → **Pay ₦100.00**.
3. Pay with a real card or bank transfer for ₦100.

## 4. What should happen (tick each)

- [ ] Paystack opens inside the app, in SchoolKit's green.
- [ ] After paying, the Paystack page **closes by itself** and you are back
      in the app, not left on a web page.
- [ ] Within a few seconds the app says the payment went through.
- [ ] The invoice shows **Paid** in the app, and on the staff website.
- [ ] The receipt is there (app and website).
- [ ] Also try once pressing **Close** on Paystack *without* paying: the app
      should say the payment was not completed, and the invoice stays unpaid.

## 5. If something goes wrong

- **Stuck on a web page after paying:** note what the address bar shows and
  send a screenshot. The payment is still recorded by the webhook; check the
  invoice on the website.
- **Paid on Paystack but the invoice stays unpaid for more than 5 minutes:**
  check the Paystack dashboard → Transactions for the reference, and the
  webhook log under Settings → API Keys & Webhooks.
- Refund the ₦100 test payment from the Paystack dashboard afterwards if you
  want it back.

When every box is ticked, mark the item done in `docs/deferred.md`.
