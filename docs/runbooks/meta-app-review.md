# Meta App Review for SchoolKit

Use a fictional school, a Meta test business portfolio, a test WABA and
test recipients. Give reviewers test credentials through Meta's review
form. Keep production switches off. Record the app and configuration IDs in
the private submission and keep access tokens, app secrets and signup codes
out of recordings and browser logs.

## whatsapp_business_messaging demonstration

1. Sign into the fictional school and identify the school-owned, separately
   billed WhatsApp account being used.
2. As a fictional guardian, open the versioned consent screen and send its
   verification command from the guardian's test phone. Show that a wrong
   originating phone or unsigned command fails.
3. Confirm a fictional partial payment in Paystack test mode. Show that one
   approved confirmation reaches the consenting recipient and a duplicate
   webhook does not send it again. Show the delivery status in SchoolKit.
4. Withdraw consent or reply STOP and show that the next queued notification
   remains blocked. Show a simulated timeout with no duplicate send or SMS
   fallback. Keep payment, student and login details fictional.

## whatsapp_business_management demonstration

1. As the fictional school owner, start Embedded Signup v4. Show the assets
   and permissions requested, the authorization-code handoff, and the
   connected result without displaying the code or business token.
2. Show the server checking the app ID, token validity, WABA scope and phone
   membership. Demonstrate rejection of a phone or WABA belonging to another
   fictional tenant. Subscribe the verified WABA to the app's webhooks.
3. Show an exact approved template and language from that WABA. Simulate a
   Utility-to-Marketing reclassification and show that automation stops
   pending a new administrator review and an effective Marketing rate.
4. Disconnect the account and show that routing and consent stop locally
   before attempting remote revocation. Demonstrate a pending revocation
   during an outage and a retry that confirms the old token is invalid.
5. Explain that this service keeps school-owned Meta billing separate from
   the SchoolKit wallet. The internal setup-call alert is a separate
   SchoolKit account and is outside the requested tenant permission use.

## Approval and rehearsal gates

- Confirm Tech Provider onboarding, business verification and required
  App Review and Advanced Access. Verify all host domains and redirect
  URIs against the v4 configuration.
- Verify support for the actual business token and approved Graph version in
  exchange, inspection, phone membership, subscription and revocation.
  Exercise the required `account_update` event and number registration in
  rehearsal. Those lifecycle steps require separate engineering coverage.
- Verify that every template has an exact approved variant on the sending
  WABA, with the actual category, language, ordered placeholders and
  buttons. Treat all unverified mappings as blocked.
- Verify display name and account billing before any production pilot. Any
  proposal to use the SchoolKit-branded internal sender for other schools
  requires explicit Meta authorization.

[Meta App Review sample](https://developers.facebook.com/docs/whatsapp/solution-providers/app-review/sample-submission/) · [Embedded Signup v4 implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation) · [Meta token revocation](https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens/)
