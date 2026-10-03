import { withTenant } from "@school-kit/db";
import type { ReleasedResultDetailDto } from "@school-kit/types";

import { LoginLockoutService, lockoutIdentity } from "../../common/auth/login-lockout";
import type { ReleasedResultsService } from "../report-cards/released-results.service";
import { portalRefusal } from "./portal-refusal";
import { RedeemRefusedError, type RedeemVia, type ResultPinService } from "./result-pin.service";

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * A signed-in family redeeming a PIN on a locked term (D54, §21.4) — shared by
 * the guardian portal and the student app so the two cannot differ.
 *
 * `authorise` runs first inside the transaction (the guardian's assertLinked;
 * nothing for the student, whose id comes from the session). Wrong PINs are
 * counted per student under the `result-pin` lockout namespace: a signed-in
 * family is no excuse for unlimited guesses at a 12-digit space.
 */
export async function unlockForPortal(
  deps: { pins: ResultPinService; releasedResults: ReleasedResultsService; lockout: LoginLockoutService },
  args: {
    schoolId: string;
    studentId: string;
    termId: string;
    pin: string;
    via: Exclude<RedeemVia, "CHECKER">;
    actorId: string;
    ipAddress: string | null;
    authorise?: (db: TenantDb) => Promise<void>;
  },
): Promise<ReleasedResultDetailDto> {
  const identity = lockoutIdentity("result-pin", args.schoolId, args.studentId);
  await deps.lockout.check(identity);

  try {
    const result = await withTenant(args.schoolId, async (db) => {
      await args.authorise?.(db);
      await deps.pins.redeem(db, {
        schoolId: args.schoolId,
        studentId: args.studentId,
        termId: args.termId,
        pin: args.pin,
        via: args.via,
        actorId: args.actorId,
        ipAddress: args.ipAddress,
      });
      // Through THE shared reader and its gate, on the unlock just written.
      return deps.releasedResults.getForStudent(db, args.studentId, args.termId);
    });
    await deps.lockout.clear(identity);
    return result;
  } catch (e) {
    if (e instanceof RedeemRefusedError) {
      await deps.lockout.recordFailure(identity);
      throw portalRefusal(e.reason);
    }
    throw e;
  }
}
