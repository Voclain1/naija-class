import { Controller, Get, UseGuards } from "@nestjs/common";
import type { SchoolContactResponse } from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import type { StudentAuthContext } from "../../common/auth/student-auth-context.js";
import { CurrentStudent } from "../../common/auth/current-student.decorator.js";
import { StudentAuthGuard } from "../../common/auth/student-auth.guard.js";
import { SchoolContactService } from "./school-contact.service.js";

// One controller per principal, like every other family surface. Both return
// the same two fields; the guard decides whose school.

@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalSchoolContactController {
  constructor(private readonly service: SchoolContactService) {}

  @Get("school")
  async get(@CurrentGuardian() ctx: GuardianAuthContext): Promise<SchoolContactResponse> {
    return this.service.get(ctx.schoolId);
  }
}

@Controller("student-portal")
@UseGuards(StudentAuthGuard)
export class StudentSchoolContactController {
  constructor(private readonly service: SchoolContactService) {}

  @Get("me/school")
  async get(@CurrentStudent() ctx: StudentAuthContext): Promise<SchoolContactResponse> {
    return this.service.get(ctx.schoolId);
  }
}
