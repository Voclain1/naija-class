import { Body, Controller, Delete, HttpCode, Param, Post, UseGuards } from "@nestjs/common";

import { registerDeviceSchema, type RegisterDeviceInput, type RegisterDeviceResponse } from "@school-kit/types";

import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context";
import { CurrentStudent } from "../../common/auth/current-student.decorator";
import { StudentAuthGuard } from "../../common/auth/student-auth.guard";
import type { StudentAuthContext } from "../../common/auth/student-auth-context";
import { DevicesService } from "./devices.service";

// Phase 6 / Slice 5 (D34, D35) — device registration for both principals.
//
// TWO CONTROLLERS, NOT ONE with a branch. They differ only in guard and
// route prefix, which is exactly the reason to keep them apart: a single
// controller would need one guard that accepts either principal, and the
// whole point of three separate session tables and three separate resolvers
// is that a guardian's token and a student's token are not interchangeable
// (see CLAUDE.md's SECURITY DEFINER cadence review on why the resolvers are
// deliberately NOT merged). The shared logic lives in the service, where it
// is reached only after a guard has already decided who is calling.
//
// The token is a PATH PARAMETER on DELETE rather than a body, matching REST
// convention for deleting a named resource. It is not secret — possession
// lets you send TO a device, not read from one — and the service scopes the
// delete to the caller's own id regardless.

@Controller("portal/devices")
@UseGuards(GuardianAuthGuard)
export class PortalDevicesController {
  constructor(private readonly service: DevicesService) {}

  @Post()
  @HttpCode(200)
  async register(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Body(new ZodValidationPipe(registerDeviceSchema)) dto: RegisterDeviceInput,
  ): Promise<RegisterDeviceResponse> {
    return this.service.registerForGuardian(guardianCtx, dto);
  }

  @Delete(":token")
  @HttpCode(204)
  async unregister(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("token") token: string,
  ): Promise<void> {
    await this.service.unregisterForGuardian(guardianCtx, token);
  }
}

@Controller("student-portal/devices")
@UseGuards(StudentAuthGuard)
export class StudentDevicesController {
  constructor(private readonly service: DevicesService) {}

  @Post()
  @HttpCode(200)
  async register(
    @CurrentStudent() studentCtx: StudentAuthContext,
    @Body(new ZodValidationPipe(registerDeviceSchema)) dto: RegisterDeviceInput,
  ): Promise<RegisterDeviceResponse> {
    return this.service.registerForStudent(studentCtx, dto);
  }

  @Delete(":token")
  @HttpCode(204)
  async unregister(
    @CurrentStudent() studentCtx: StudentAuthContext,
    @Param("token") token: string,
  ): Promise<void> {
    await this.service.unregisterForStudent(studentCtx, token);
  }
}
