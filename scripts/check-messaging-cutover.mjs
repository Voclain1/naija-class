// Read-only candidate configuration check. Never print secret values or
// raw parser exceptions. Node dotenv parsing is a structural preflight,
// not a substitute for checking the actual Docker/Nest runtime in rehearsal.
import { parseEnv } from "node:util";
const failures = [];
const check = (ok, label) => { console.log((ok ? "PASS " : "BLOCK ") + label); if (!ok) failures.push(label); };
let env;
try { env = parseEnv(process.env.API_ENV_FILE ?? ""); } catch { console.log("BLOCK candidate API configuration could not be parsed"); process.exit(1); }
const mode = env.PAYSTACK_WEBHOOK_MODE;
const apiKey = env.PAYSTACK_SECRET_KEY ?? "";
check(mode === "live" && apiKey.startsWith("sk_live_") && !apiKey.endsWith("_replace_me"), "explicit live Paystack mode and matching API key shape");
const requireModern = env.PAYSTACK_WEBHOOK_REQUIRE_MODERN;
check(requireModern === "on" || requireModern === "off", "explicit modern-only or legacy transition authentication mode");
const reviewBy = env.PAYSTACK_WEBHOOK_LEGACY_REVIEW_BY ?? "";
const reviewDate = /^\d{4}-\d{2}-\d{2}$/.test(reviewBy) ? Date.parse(reviewBy + "T23:59:59Z") : NaN;
const nowMs = Date.now();
const boundedReview = Number.isFinite(reviewDate) && new Date(reviewDate).toISOString().slice(0,10) === reviewBy && reviewDate > nowMs && reviewDate - nowMs <= 31 * 86400000;
if (requireModern === "off") {
  check(boundedReview, "legacy transition has an explicit future review deadline within 31 days");
  console.log("NOTICE legacy HMAC authentication is transitional; live delivery and rollback evidence still required");
}
let keys;
try { keys = JSON.parse(env.PAYSTACK_WEBHOOK_LIVE_KEYS ?? ""); } catch { keys = null; }
const validKeyring = !!keys && typeof keys === "object" && !Array.isArray(keys) && Object.keys(keys).length > 0 && Object.keys(keys).length <= 8 && Object.entries(keys).every(([kid,secret]) => /^whk_[A-Za-z0-9_-]{1,80}$/.test(kid) && typeof secret === "string" && /^whsec_[A-Za-z0-9_-]{1,256}$/.test(secret));
if (requireModern === "on" || env.PAYSTACK_WEBHOOK_LIVE_KEYS) {
  check(validKeyring, "live webhook keyring has accepted structure (not provider verification)");
} else if (requireModern === "off") {
  console.log("NOTICE no modern live keyring configured for explicit legacy transition");
}
const gated = ["MESSAGING_PAID_ENABLED","MESSAGING_TOP_UPS_ENABLED","MESSAGING_TOP_UP_RECOVERY_ENABLED","MESSAGING_META_SIGNUP_ENABLED","MESSAGING_META_WEBHOOK_ENABLED","MESSAGING_META_PHONE_REGISTRATION_ENABLED","MESSAGING_META_TEMPLATE_SUBMISSION_ENABLED","MESSAGING_META_INBOUND_HISTORY_ENABLED","MESSAGING_TERMII_REPORTS_ENABLED"];
for (const name of gated) check(env[name] === undefined || env[name] === "off", name + " disabled");
const decision = env.MESSAGING_LEGACY_SMS_MIGRATION_MODE;
const release = env.MESSAGING_LEGACY_SMS_ENABLED;
const active = release === "on" || decision === "existing-authorized";
check((decision === "off" && (release === "off" || release === undefined)) || (decision === "existing-authorized" && (release === "off" || release === undefined)), "explicit bounded legacy SMS decision (no broad activation)");
if (active) {
  const producers = new Set(["ADMISSION","PARENT_MESSAGE","GUARDIAN_INVITATION","SICKBAY","FEE_REMINDER","REMINDER_CAMPAIGN","HOSTEL_EXEAT","DISCIPLINE"]);
  const cap = x => typeof x === "string" && /^[1-9]\d{0,9}$/.test(x) && BigInt(x) <= 2147483647n;
  let auth, rates;
  try { auth = JSON.parse(env.MESSAGING_LEGACY_SMS_AUTHORIZATIONS ?? ""); rates = JSON.parse(env.MESSAGING_LEGACY_SMS_RATES ?? ""); } catch { auth = null; rates = null; }
  check(!!env.TERMII_API_KEY && env.TERMII_API_KEY !== "replace-me", "Termii account credential configured");
  check(cap(env.MESSAGING_PAID_PLATFORM_DAILY_KOBO), "positive bounded platform ceiling");
  check(!!auth && typeof auth === "object" && !Array.isArray(auth) && Object.keys(auth).length > 0 && Object.entries(auth).every(([id,row]) => /^[a-f0-9-]{36}$/i.test(id) && row && cap(row.dailyKobo) && Array.isArray(row.producers) && row.producers.length > 0 && row.producers.every(p => producers.has(p))), "nonempty school and producer authorization structure");
  const now = Date.now();
  const current = Array.isArray(rates) ? rates.filter(r => r?.key === "TERMII_SMS" && Date.parse(r.effectiveFrom) <= now && now < Date.parse(r.effectiveUntil)) : [];
  check(current.length === 1 && current.every(r => typeof r.version === "string" && !!r.version.trim() && typeof r.evidence === "string" && !!r.evidence.trim() && Date.parse(r.verifiedAt) <= now && cap(r.providerAmount) && cap(r.rateNumerator) && cap(r.rateDenominator) && /^\d{1,6}$/.test(r.taxBasisPoints) && /^\d{1,6}$/.test(r.marginBasisPoints)), "one effective legacy rate with evidence fields");
}
check(process.env.FLY_DEPLOY_DISABLED === "true", "Fly automatic deployment disabled");
check(process.env.VPS_MODE === "live", "VPS deployment target explicitly live");
console.log("Provider header delivery, authorized SMS inventory, backup/restore and cutover rehearsal are separate human evidence gates.");
process.exitCode = failures.length ? 1 : 0;
