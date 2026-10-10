// Counts repeated validation failures so a form people cannot get past shows
// up in monitoring.
//
// HttpExceptionFilter deliberately sends no modelled 4xx to Sentry: most are
// a stale link or a malformed request, not an incident. The cost of that rule
// was the onboarding step-5 incident (2026-09-11): the API correctly answered
// 400 "First Term must fall within the academic year" to every owner who
// changed their year's dates, for three weeks, and nothing counted it. A
// blocked owner does not file a bug; they leave.
//
// So this does not capture each 400. It counts them per
// (route template, issue path, issue code) and reports ONCE per window when a
// key reaches the threshold: one Sentry warning, fingerprinted so repeats of
// the same key group into one issue whose event count is the trend.
//
// Never reads the request body, the URL's ids or query, the error message, or
// an issue's message. Zod's default messages quote the rejected value
// ("received 'x'"), and payloads here carry school and student PII. What is
// kept is the shape of the failure only: the route template
// (`/api/v1/students/:id`), the field path with indexes and ids replaced by
// `*`, and the validator's code.

import { Logger } from "@nestjs/common";

import { Sentry } from "./sentry";

export const VALIDATION_FAILURE_THRESHOLD = 5;
export const VALIDATION_FAILURE_WINDOW_MS = 60 * 60 * 1000;
// Bounds memory if something generates endless distinct keys. Expired windows
// are dropped first; past the cap, new keys are simply not counted.
const MAX_TRACKED_KEYS = 2000;

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;
const SAFE_TOKEN = /^[A-Za-z0-9_*.-]{1,120}$/;

export interface ValidationFailureInput {
  method: string;
  /** Route template as Express matched it, e.g. "/api/v1/students/:id". */
  route: string;
  /** The error's code, e.g. "VALIDATION_ERROR" or "INVALID_CSV". */
  errorCode: string;
  details: unknown;
}

interface Bucket {
  windowStart: number;
  count: number;
}

export interface ValidationFailureKey {
  method: string;
  route: string;
  errorCode: string;
  issuePath: string;
  issueCode: string;
}

/**
 * The (path, code) pairs of an error's `details.issues`, normalised so they
 * group and carry no data. Errors without issues count once under "(none)".
 */
export function issueShapes(details: unknown): Array<{ path: string; code: string }> {
  const issues = (details as { issues?: unknown } | null | undefined)?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return [{ path: "(none)", code: "(none)" }];
  const seen = new Map<string, { path: string; code: string }>();
  for (const issue of issues) {
    const rawPath = (issue as { path?: unknown } | null)?.path;
    const rawCode = (issue as { code?: unknown } | null)?.code;
    const path = normalisePath(rawPath);
    const code = typeof rawCode === "string" && SAFE_TOKEN.test(rawCode) ? rawCode : "(other)";
    seen.set(`${path}|${code}`, { path, code });
  }
  return [...seen.values()];
}

function normalisePath(raw: unknown): string {
  const segments = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string" && raw.length > 0
      ? raw.split(".")
      : [];
  if (segments.length === 0) return "(root)";
  const normalised = segments
    .map((s) => (NUMERIC_SEGMENT.test(s) || UUID_SEGMENT.test(s) ? "*" : s))
    .join(".");
  return SAFE_TOKEN.test(normalised) ? normalised : "(other)";
}

export class ValidationFailureMonitor {
  private readonly buckets = new Map<string, Bucket>();
  private readonly logger = new Logger(ValidationFailureMonitor.name);

  constructor(private readonly now: () => number = Date.now) {}

  record(input: ValidationFailureInput): void {
    const t = this.now();
    for (const shape of issueShapes(input.details)) {
      const key: ValidationFailureKey = {
        method: input.method,
        route: input.route,
        errorCode: SAFE_TOKEN.test(input.errorCode) ? input.errorCode : "(other)",
        issuePath: shape.path,
        issueCode: shape.code,
      };
      const id = `${key.method} ${key.route}|${key.errorCode}|${key.issuePath}|${key.issueCode}`;
      let bucket = this.buckets.get(id);
      if (!bucket || t - bucket.windowStart >= VALIDATION_FAILURE_WINDOW_MS) {
        if (!bucket && !this.makeRoom(t)) continue;
        bucket = { windowStart: t, count: 0 };
        this.buckets.set(id, bucket);
      }
      bucket.count += 1;
      if (bucket.count === VALIDATION_FAILURE_THRESHOLD) this.report(key);
    }
  }

  private makeRoom(t: number): boolean {
    if (this.buckets.size < MAX_TRACKED_KEYS) return true;
    for (const [id, bucket] of this.buckets) {
      if (t - bucket.windowStart >= VALIDATION_FAILURE_WINDOW_MS) this.buckets.delete(id);
    }
    return this.buckets.size < MAX_TRACKED_KEYS;
  }

  private report(key: ValidationFailureKey): void {
    const summary =
      `Repeated validation failure: ${key.method} ${key.route} — ${key.issuePath} (${key.issueCode}), ` +
      `${VALIDATION_FAILURE_THRESHOLD} times within ${VALIDATION_FAILURE_WINDOW_MS / 60_000} minutes`;
    this.logger.warn(summary);
    Sentry.captureMessage(summary, {
      level: "warning",
      fingerprint: ["repeated-validation-failure", key.method, key.route, key.errorCode, key.issuePath, key.issueCode],
      tags: {
        kind: "repeated-validation-failure",
        route: `${key.method} ${key.route}`,
        error_code: key.errorCode,
        issue_path: key.issuePath,
        issue_code: key.issueCode,
      },
    });
  }
}

export const validationFailureMonitor = new ValidationFailureMonitor();
