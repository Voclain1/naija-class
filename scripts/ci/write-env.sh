#!/usr/bin/env bash
# Writes the CI-only repo-root `.env` (the file every local command reads: the API's ConfigModule,
# apps/api's vitest config, packages/db's migrate and seed). None of the values is real: Sentry and
# PostHog DSNs are blank, and no test calls Anthropic, Paystack, Termii, Resend or R2.
# Previously duplicated verbatim in two jobs of ci.yml; one copy now, so they cannot drift.
set -euo pipefail
cat > "${1:-.env}" <<'ENV'
NODE_ENV=test
DATABASE_URL=postgresql://app_user:app_user@localhost:5432/school_kit?schema=public
DIRECT_URL=postgresql://school_kit:school_kit@localhost:5432/school_kit?schema=public
REDIS_URL=redis://localhost:6379
BETTER_AUTH_SECRET=ci-test-secret-not-used-for-real-auth-0000000000000000
BETTER_AUTH_URL=http://localhost:3001
API_PORT=4000
API_URL=http://localhost:4000
CORS_ORIGIN=http://localhost:3001
CORS_ORIGIN_PORTAL=http://localhost:3002
CORS_ORIGIN_CBT=http://localhost:3003
WEB_BASE_URL=http://localhost:3001
PORTAL_BASE_URL=http://localhost:3002
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
# MUST contain the literal "placeholder": that substring is how AiGenerationService and the
# live-generation eval decide a key is not real (apps/api/src/common/ai/ai-generation.service.ts).
# With any other value CI would report AI as CONFIGURED and build a real Anthropic client around a
# bogus key (what broke ai.module.spec.ts on PR #158).
ANTHROPIC_API_KEY=sk-ant-placeholder-not-used-in-ci
PAYSTACK_SECRET_KEY=sk_test_not_used_in_ci
PAYSTACK_PUBLIC_KEY=pk_test_not_used_in_ci
PAYSTACK_SETUP_EMAIL=payments-not-used-in-ci@schoolkit.ng
TERMII_API_KEY=not-used-in-ci
TERMII_SENDER_ID=SchoolKit
RESEND_API_KEY=re_not_used_in_ci
R2_ACCOUNT_ID=not-used-in-ci
R2_ACCESS_KEY_ID=not-used-in-ci
R2_SECRET_ACCESS_KEY=not-used-in-ci
R2_BUCKET=school-kit-ci
SENTRY_DSN_API=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_ENVIRONMENT=ci
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
ENV
