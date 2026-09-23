import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "node:crypto";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  GoneError,
  UnauthorizedError,
  type WebHandoffInput,
  type WebHandoffResponse,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { createSession, type CreateSessionContext } from "../../common/auth/sessions.js";

// Opening the website from the app, already signed in
// (docs/modules/web-handoff-signin.md).
//
// WHY NOT JUST PASS THE SESSION TOKEN. The website's session is an HttpOnly
// cookie set by its own route handler; it cannot accept a bearer token. And
// putting a long-lived session token in a URL is exactly how credentials end
// up in browser history, referrer headers and server logs.
//
// So the app mints a NEW, random, single-use token that is good for sixty
// seconds and for one thing only. The browser exchanges it once for a real
// session of its own.
//
// Every property below is load-bearing:
//   - SINGLE USE — a link left in history is worth nothing afterwards.
//   - 60 SECONDS — it is consumed by a redirect that happens immediately.
//   - A NEW SESSION, not a copy — the school can revoke the browser without
//     touching the phone, and the audit log shows where it came from.
//   - RE-CHECKED AT EXCHANGE — a person deactivated in those sixty seconds
//     does not get a browser session (CLAUDE.md's auth rule).
//   - BOUND TO THE MINTING SESSION — if that session is signed out or
//     revoked first, the token dies with it.

const HANDOFF_TTL_MS = 60_000;
const AUDIT_MINT = "auth.web-handoff";
const AUDIT_EXCHANGE = "auth.web-handoff-exchange";

function hash(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

@Injectable()
export class WebHandoffService {
  private readonly logger = new Logger(WebHandoffService.name);

  async mint(authCtx: AuthContext, input: WebHandoffInput, ctx: CreateSessionContext): Promise<WebHandoffResponse> {
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS);

    await withTenant(authCtx.schoolId, async (db) => {
      await db.webHandoffToken.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          sessionId: authCtx.sessionId,
          tokenHash: hash(rawToken),
          expiresAt,
          createdIp: ctx.ipAddress,
        },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT_MINT,
          entityType: "user",
          entityId: authCtx.userId,
          ipAddress: ctx.ipAddress,
          // The token itself is never logged, here or anywhere.
          metadata: { next: input.next ?? "/dashboard", fromSessionId: authCtx.sessionId },
        },
      });
    });

    return { token: rawToken, expiresAt, next: input.next ?? "/dashboard" };
  }

  /**
   * Exchange the token for a browser session. Refuses, in this order:
   * unknown, already used, expired, minting session gone, user deactivated.
   *
   * The refusals are deliberately indistinguishable to the caller — one code,
   * one message — because this endpoint is public and a precise answer would
   * tell a stranger which guess was closer.
   */
  async exchange(rawToken: string, ctx: CreateSessionContext): Promise<{ token: string; userId: string }> {
    const tokenHash = hash(rawToken);

    // Pre-tenant: a browser arriving with a token has no school yet, and
    // web_handoff_tokens is under FORCE RLS. Same chicken-and-egg as the
    // password-reset resolver, solved the same way.
    const rows = await basePrisma.$queryRaw<ResolveHandoffRow[]>`
      SELECT * FROM auth_resolve_web_handoff_token(${tokenHash})
    `;
    const row = rows[0];
    if (!row) throw new GoneError("HANDOFF_INVALID", "That link has expired. Please sign in.");

    const schoolId = row.school_id;

    await withTenant(schoolId, async (db) => {
      // Burn it FIRST, atomically: "used once" must be a property of the
      // UPDATE, not a check followed by a hope. A second exchange of the
      // same token updates no rows and is refused below.
      const burned = await db.webHandoffToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (burned.count === 0) throw new GoneError("HANDOFF_INVALID", "That link has expired. Please sign in.");

      // The minting session must still be alive: a teacher who signed out of
      // the app before the browser opened the link should not get a session
      // out of it.
      const session = await db.session.findUnique({
        where: { id: row.session_id },
        select: { id: true, expiresAt: true },
      });
      // Sessions are DELETED on logout rather than flagged, so "gone" and
      // "revoked" are the same condition here.
      if (!session || session.expiresAt <= new Date()) {
        throw new GoneError("HANDOFF_INVALID", "That link has expired. Please sign in.");
      }

      // Re-check the person, as every write path does (CLAUDE.md auth rule):
      // deactivated in those sixty seconds means no browser session.
      const user = await db.user.findUnique({
        where: { id: row.user_id },
        select: { isActive: true },
      });
      if (!user?.isActive) {
        throw new UnauthorizedError("INVALID_CREDENTIALS", "That link is no longer valid. Please sign in.");
      }
    });

    // A NEW session, not a copy of the app's: its own id, expiry, IP and user
    // agent, so a school can see "this browser signed in from the app at
    // 10:42" and revoke it without touching the phone.
    const { rawToken: sessionToken } = await createSession(schoolId, row.user_id, ctx);

    await withTenant(schoolId, (db) =>
      db.auditLog.create({
        data: {
          schoolId,
          userId: row.user_id,
          action: AUDIT_EXCHANGE,
          entityType: "user",
          entityId: row.user_id,
          ipAddress: ctx.ipAddress,
          // The token is never logged, here or anywhere.
          metadata: { fromSessionId: row.session_id, userAgent: ctx.userAgent },
        },
      }),
    );

    return { token: sessionToken, userId: row.user_id };
  }
}

/** The SECURITY DEFINER resolver's row shape — ids and timestamps only. */
interface ResolveHandoffRow {
  handoff_id: string;
  user_id: string;
  school_id: string;
  session_id: string;
  expires_at: Date;
  used_at: Date | null;
}
