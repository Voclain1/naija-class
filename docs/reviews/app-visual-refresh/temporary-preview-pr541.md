# Temporary visual preview — PR #541

Status: preparation only. Do not use the production database, Redis, API or authentication cookies for preview.

## Verified repository facts
- Production VPS uses Docker Compose in `infra/vps/docker-compose.yml`.
- Caddy routes the live web container from `infra/vps/Caddyfile`.
- Production deploy workflow (`.github/workflows/deploy-vps.yml`) targets main and runs database migrations. **Do not reuse it for a preview PR.**
- The former Fly staging workflow is disabled after the VPS migration.

## Deployment acceptance gates
1. Confirm free VPS CPU, RAM, disk and port availability; do not disturb existing services.
2. Provision a separate, isolated test database and Redis namespace/instance. Use fictional data only.
3. Deploy a preview API and web app from the exact PR head SHA, with unique secrets, auth cookie scope and no production credentials.
4. Disable outbound payments, email, SMS, WhatsApp, scheduled jobs and external webhooks.
5. Configure a temporary preview host and TLS using the existing reverse proxy only after confirming DNS access. Protect it with access control.
6. Verify that preview requests cannot reach production data/services and that production endpoints are unchanged.
7. Capture authenticated desktop and mobile screenshots of attendance, class levels, class arms, teacher classes and the other core workspaces.
8. Publish screenshots/preview link on the PR; request design approval before merging.
9. Remove the temporary services, DNS and test data after approval.

## Access blocker
GitHub repository file access alone cannot inspect VPS resources, set DNS, provision secrets, run the deployment, or capture authenticated browser screenshots. Do not claim a preview is live until those steps have actually succeeded.
