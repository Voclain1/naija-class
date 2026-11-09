import { Injectable, Logger } from "@nestjs/common";
import { withTenant } from "@school-kit/db";
import { searchGuide } from "@school-kit/ai";
import {
  ASSISTANT_INACTIVITY_MINUTES,
  ASSISTANT_WORKFLOWS,
  ForbiddenError,
  PERMISSION_WILDCARD,
  UnauthorizedError,
  type AssistantCapabilitiesDto,
  type AssistantHelpHitDto,
  type AssistantWorkflow,
  type FeatureKey,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { FeatureSwitchesService } from "../../common/features/feature-switches.service";

// The SchoolKit Assistant workspace (docs/modules/assistant-workspace.md).
//
// Two read-only endpoints. Capabilities tells the panel which workflows this
// person may start, from the SAME rules each workflow's own service enforces
// again on every request (switch, active account, permissions, role). Help
// searches the in-app guide lexically. No model is called, nothing is
// written, and the question text is neither stored nor logged.

const WORKFLOW_RULES: Record<AssistantWorkflow, { feature: FeatureKey; read: string[]; approve: string[]; adminRole: boolean }> = {
  invoices: { feature: "assistant-billing", read: ["invoice.read"], approve: ["invoice.read", "invoice.issue"], adminRole: false },
  reminders: { feature: "reminder-campaigns", read: ["finance.debtors.read", "finance.debtors.remind"], approve: ["finance.debtors.read", "finance.debtors.remind"], adminRole: false },
  intake: { feature: "student-intake", read: ["student.create"], approve: ["student.create"], adminRole: true },
  corrections: { feature: "student-corrections", read: ["student.read", "student.update"], approve: ["student.read", "student.update"], adminRole: true },
};
const ADMIN_ROLES = new Set(["owner", "admin"]);

@Injectable()
export class AssistantWorkspaceService {
  private readonly logger = new Logger(AssistantWorkspaceService.name);

  constructor(private readonly features: FeatureSwitchesService) {}

  async capabilities(auth: AuthContext): Promise<AssistantCapabilitiesDto> {
    const { permissions, roles } = await this.person(auth);
    const holds = (list: string[]) => permissions.has(PERMISSION_WILDCARD) || list.every((p) => permissions.has(p));
    const isAdmin = roles.some((r) => ADMIN_ROLES.has(r));
    const enabled = await this.features.isOn(auth.schoolId, "assistant-workspace");
    const workflows = {} as AssistantCapabilitiesDto["workflows"];
    for (const w of ASSISTANT_WORKFLOWS) {
      const rule = WORKFLOW_RULES[w];
      const permitted = holds(rule.read) && (!rule.adminRole || isAdmin);
      const on = enabled && (await this.features.isOn(auth.schoolId, rule.feature));
      workflows[w] = {
        available: permitted && on,
        reason: !permitted ? "NO_PERMISSION" : !on ? "FEATURE_OFF" : null,
        canApprove: permitted && on && holds(rule.approve),
      };
    }
    return {
      enabled,
      workflows,
      help: { available: enabled },
      modelRouting: { available: false, reason: "NOT_APPROVED" },
      inactivityMinutes: ASSISTANT_INACTIVITY_MINUTES,
    };
  }

  /** Guide sections for a help question. The question is used for this search only. */
  async help(auth: AuthContext, question: string): Promise<{ hits: AssistantHelpHitDto[] }> {
    await this.person(auth);
    if (!(await this.features.isOn(auth.schoolId, "assistant-workspace"))) {
      throw new ForbiddenError("The SchoolKit Assistant is switched off for this school.");
    }
    const hits = searchGuide(question, { limit: 3, maxExcerptChars: 600 });
    this.logger.debug(`Assistant help search: school=${auth.schoolId} hits=${hits.length}`);
    return { hits: hits.map((h) => ({ anchor: h.anchor, title: h.title, path: h.path, excerpt: h.excerpt })) };
  }

  /** Re-reads the person now: active status, permissions and role keys. */
  private async person(auth: AuthContext): Promise<{ permissions: Set<string>; roles: string[] }> {
    return withTenant(auth.schoolId, async (db) => {
      const user = await db.user.findFirst({ where: { id: auth.userId, schoolId: auth.schoolId }, select: { isActive: true } });
      if (!user?.isActive) throw new UnauthorizedError("USER_INACTIVE", "Your account is unavailable.");
      const grants = await db.userRole.findMany({ where: { userId: auth.userId }, select: { role: { select: { key: true, permissions: true } } } });
      return {
        roles: grants.map((g) => g.role.key),
        permissions: new Set(grants.flatMap((g) => (Array.isArray(g.role.permissions) ? (g.role.permissions as string[]) : []))),
      };
    }, { label: "assistant-workspace-person" });
  }
}
