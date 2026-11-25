// Read-only Termii account evidence. This script never sends a message and
// never prints the API key, wallet balance, account name, or raw responses.
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function checkTermiiAccount(apiEnvFile, fetchImpl = fetch) {
  let env;
  try { env = parseEnv(apiEnvFile ?? ""); } catch { return { ok: false, lines: ["BLOCK candidate API configuration could not be parsed for Termii evidence"] }; }
  const key = env.TERMII_API_KEY;
  if (!key || key === "replace-me") return { ok: false, lines: ["BLOCK Termii account credential is unavailable"] };

  let base;
  try {
    base = new URL(env.TERMII_BASE_URL ?? "");
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error();
  } catch {
    return { ok: false, lines: ["BLOCK explicit HTTPS Termii account base URL is unavailable"] };
  }
  const root = base.toString().replace(/\/$/, "");
  const request = async (path) => {
    const url = new URL(root + path);
    url.searchParams.set("api_key", key);
    const response = await fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error();
    return response.json();
  };

  let balance;
  let senders;
  try {
    [balance, senders] = await Promise.all([request("/api/get-balance"), request("/api/sender-id")]);
  } catch {
    return { ok: false, lines: ["BLOCK Termii read-only account evidence could not be retrieved"] };
  }
  const available = typeof balance?.balance === "number" && Number.isFinite(balance.balance) && balance.balance > 0;
  const currency = typeof balance?.currency === "string" && /^[A-Z]{3}$/.test(balance.currency) ? balance.currency : null;
  const rows = Array.isArray(senders?.content) ? senders.content : [];
  const schoolKit = rows.find((row) => typeof row?.sender_id === "string" && row.sender_id.toLowerCase() === "schoolkit");
  const status = typeof schoolKit?.status === "string" && /^[A-Za-z -]{1,40}$/.test(schoolKit.status)
    ? schoolKit.status.toLowerCase() : "not-returned";
  return {
    ok: available && !!currency,
    lines: [
      `${currency ? "PASS" : "BLOCK"} Termii credential authenticated and wallet currency returned${currency ? ` (${currency})` : ""}`,
      `${available ? "PASS" : "BLOCK"} Termii wallet has positive capacity (amount redacted)`,
      `EVIDENCE SchoolKit sender status: ${status}`,
      "NOTICE DND activation and account-specific unit rates are not established by these read-only endpoints",
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkTermiiAccount(process.env.API_ENV_FILE);
  for (const line of result.lines) console.log(line);
  if (!result.ok) process.exitCode = 1;
}
