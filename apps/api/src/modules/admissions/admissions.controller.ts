import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Put, Query, UseGuards } from "@nestjs/common";
import {
  listAdmissionsSchema,
  setAdmissionOfficersSchema,
  updateAdmissionSettingsSchema,
  type AdmissionDetailDto,
  type AdmissionListDto,
  type AdmissionOfficerDto,
  type AdmissionSettingsDto,
  type ListAdmissionsInput,
  type SetAdmissionOfficersInput,
  type UpdateAdmissionSettingsInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AdmissionsSettingsService } from "./admissions-settings.service.js";
import { AdmissionsService } from "./admissions.service.js";

// Phase 9 / CP7.1 — the school's side of admissions (docs/modules/phase-9.md
// §16.8). admission.read / admission.manage: owner, admin and the optional
// Admissions officer. Settings and officers need admission.settings, which
// only owner and admin hold; the service re-checks the role on every call.
@Controller("admissions")
@UseGuards(AuthGuard, PermissionsGuard)
export class AdmissionsController {
  constructor(
    private readonly service: AdmissionsService,
    private readonly settings: AdmissionsSettingsService,
  ) {}

  @Get("settings")
  @Permissions("admission.settings")
  getSettings(@CurrentUser() authCtx: AuthContext): Promise<AdmissionSettingsDto> {
    return this.settings.get(authCtx);
  }

  @Put("settings")
  @Permissions("admission.settings")
  updateSettings(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(updateAdmissionSettingsSchema)) dto: UpdateAdmissionSettingsInput,
    @Ip() ip: string,
  ): Promise<AdmissionSettingsDto> {
    return this.settings.update(authCtx, dto, { ipAddress: ip });
  }

  @Get("officers")
  @Permissions("admission.settings")
  officers(@CurrentUser() authCtx: AuthContext): Promise<AdmissionOfficerDto[]> {
    return this.settings.officers(authCtx);
  }

  @Put("officers")
  @Permissions("admission.settings")
  setOfficers(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(setAdmissionOfficersSchema)) dto: SetAdmissionOfficersInput,
    @Ip() ip: string,
  ): Promise<AdmissionOfficerDto[]> {
    return this.settings.setOfficers(authCtx, dto, { ipAddress: ip });
  }

  @Get("applications")
  @Permissions("admission.read")
  list(@CurrentUser() authCtx: AuthContext, @Query(new ZodValidationPipe(listAdmissionsSchema)) query: ListAdmissionsInput): Promise<AdmissionListDto> {
    return this.service.list(authCtx, query);
  }

  @Get("applications/:id")
  @Permissions("admission.read")
  get(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<AdmissionDetailDto> {
    return this.service.get(authCtx, id);
  }

  @Get("applications/:id/documents/:documentId/url")
  @Permissions("admission.read")
  documentUrl(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("documentId", new ParseUUIDPipe()) documentId: string,
    @Ip() ip: string,
  ): Promise<{ url: string }> {
    return this.service.documentUrl(authCtx, id, documentId, { ipAddress: ip });
  }
}
