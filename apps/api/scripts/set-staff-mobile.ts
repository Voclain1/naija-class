import { parseStaffMobileRolloutArgs } from "../src/common/auth/staff-mobile-rollout.args.js";

async function main(): Promise<void> {
  const parsed = parseStaffMobileRolloutArgs(process.argv.slice(2));
  console.info(`${parsed.apply ? "APPLY" : "DRY RUN"}: staff mobile ${parsed.enabled ? "enable" : "disable"} for ${parsed.schoolId}`);
  if (!parsed.apply) {
    console.info("No rows written. Repeat the exact school id with --apply --confirm-school-id.");
    return;
  }
  const token = process.env.PLATFORM_ADMIN_TOKEN;
  if (!token) throw new Error("PLATFORM_ADMIN_TOKEN is required in apply mode.");
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:4000/api/v1";
  const response = await fetch(`${baseUrl}/platform-admin/schools/${encodeURIComponent(parsed.schoolId)}/staff-mobile`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ staffMobileEnabled: parsed.enabled }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Platform-admin API rejected rollout (${response.status}): ${body}`);
  console.info(`Verified API response: ${body}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
