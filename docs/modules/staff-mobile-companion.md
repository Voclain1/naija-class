# Staff mobile companion

**Status:** approved 2026-08-24. CP1 in progress.

This addendum supersedes only Phase 6's original “not a teacher mobile app”
boundary. Staff is one principal with existing role grants, not four new
principals. Native scope is teacher daily attendance, bursar collection
monitoring, and the owner/admin operational dashboard. Everything else uses a
fixed-origin browser handoff. Payroll, BVN, staff/role management, school
configuration, bulk imports, refunds, payment recording or approval, and 2FA
setup/disable remain web-only.

The session union is guardian/student/staff. Staff login has dedicated mobile
routes, a challenge audience that cannot be exchanged with web 2FA, a random
install-scoped device id, and a mobile session row capped at seven days by
`STAFF_MOBILE_SESSION_TTL_HOURS` (values above 168 are clamped). Staff tokens
may be persisted only when an OS credential is enrolled. Cold launch and a
return after more than two minutes require biometric/device-credential
re-entry. Staff data is protected from screenshots/app-switcher previews where
the OS supports it and is never persisted in the offline query cache. Cache
keys for later workflow reads begin `["staff", schoolId, userId, ...]`. There
are no queued/offline staff writes and no staff push notifications.

Remote session listing/revocation exposes only device label and timestamps,
never token hashes, IP addresses, or full user agents. Revocation is
tenant/user scoped, actor audited, and invalidates Redis immediately. Rollout
is gated by `School.staffMobileEnabled`, default false, and is enabled one
reviewed school at a time.

Checkpoints: CP1 auth/security foundation; CP2 teacher attendance; CP3 bursar
monitoring; CP4 owner/admin dashboard and web handoffs; CP5 one-school rollout.
No workflow screen begins before CP1 has real Postgres/Redis and real-device
evidence.
