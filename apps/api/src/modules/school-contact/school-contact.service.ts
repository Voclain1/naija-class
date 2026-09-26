import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import type { SchoolContactResponse } from "@school-kit/types";

// "Who is my school, and how do I ring them?" — Part D's one server addition
// (docs/modules/the-school-day.md D12).
//
// The APP already has this from its session; the PORTAL never did. It knew the
// child, the invoices and the calendar and had no idea what school it was
// showing them for, because nothing had needed it until a parent wanted to make
// a phone call.
//
// The school id comes from the SESSION, never the request, so there is no id
// here for anyone to swap for another school's — the same rule bank details
// follow. No withGuardian() either: a switchboard number belongs to the school,
// not to any one child.
@Injectable()
export class SchoolContactService {
  async get(schoolId: string): Promise<SchoolContactResponse> {
    const school = await withTenant(schoolId, (db) =>
      db.school.findUniqueOrThrow({
        where: { id: schoolId },
        // Two fields, and no more: an address and an email are not needed to
        // place a call, and this response lands in a parent's browser.
        select: { name: true, phone: true },
      }),
    );
    return { name: school.name, phone: school.phone };
  }
}
