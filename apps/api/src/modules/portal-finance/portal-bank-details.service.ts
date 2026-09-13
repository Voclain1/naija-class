import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import { resolveSchoolBankDetails, type PortalBankDetailsResponse } from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context";

@Injectable()
export class PortalBankDetailsService {
  // GET /portal/bank-details — the guardian's OWN school only. The school id
  // comes from the guardian session, never from the request, so there is no
  // id here for a guardian to swap for another school's.
  //
  // No withGuardian(): these details are the school's, displayed on purpose
  // to its parents, and do not belong to any one child.
  async getForGuardian(guardianCtx: GuardianAuthContext): Promise<PortalBankDetailsResponse> {
    const school = await withTenant(guardianCtx.schoolId, (db) =>
      db.school.findUnique({
        where: { id: guardianCtx.schoolId },
        select: {
          bankName: true,
          bankAccountName: true,
          bankAccountNumber: true,
          bankDetailsEnabled: true,
        },
      }),
    );

    // Resolved HERE, not in the portal page. See PortalBankDetailsResponse:
    // a school that has filled in an account but not switched it on must not
    // send those digits to a parent's browser at all.
    return { bankTransfer: resolveSchoolBankDetails(school) };
  }
}
