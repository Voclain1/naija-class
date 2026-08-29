import type { SessionEndReason } from "../api/client";
import type { Principal } from "./principal";

export interface SessionEndNotice {
  principal: Principal;
  reason: SessionEndReason;
  message: string;
}

export function sessionEndNoticeForPrincipal(
  notice: SessionEndNotice | null,
  principal: Principal,
): SessionEndNotice | null {
  return notice?.principal === principal ? notice : null;
}

export function sessionEndMessage(reason: SessionEndReason): string {
  switch (reason) {
    case "SESSION_EXPIRED":
      return "Your session expired. Sign in again to continue.";
    case "USER_INACTIVE":
      return "Your account is no longer active. Contact your school administrator.";
    case "INVALID_SESSION":
    case "MISSING_BEARER_TOKEN":
      return "Your session ended. Sign in again.";
  }
}
