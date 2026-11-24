import { createHash, randomBytes } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type PrismaClient, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, ValidationError } from "@school-kit/types";

import type { AuthContext } from "../../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../../common/auth/role-check";
import { metaTokenKey, openMetaToken, sealMetaToken } from "./meta-credentials";
import { manageMetaSubscription, revokeMetaToken, type MetaSignupConfig, verifyMetaSignup } from "./meta-signup-graph";

export interface MetaSignupInput {
  code: string;
  state: string;
  wabaId: string;
  phoneNumberId: string;
}

const stateHash = (value: string) => createHash("sha256").update(value).digest("hex");
const validId = (value: string | undefined): value is string => !!value && /^\d{1,32}$/.test(value);

@Injectable()
export class MetaConnectionsService {
  constructor(private readonly config: ConfigService) {}

  private settings(requireEnabled: boolean): { graph: MetaSignupConfig; key: Buffer } {
    const appId = this.config.get<string>("MESSAGING_META_APP_ID");
    const appSecret = this.config.get<string>("MESSAGING_META_APP_SECRET");
    const configId = this.config.get<string>("MESSAGING_META_SIGNUP_CONFIG_ID");
    const graphVersion = this.config.get<string>("MESSAGING_META_GRAPH_VERSION");
    const key = metaTokenKey(this.config.get<string>("MESSAGING_META_TOKEN_KEY"));
    if ((requireEnabled && this.config.get<string>("MESSAGING_META_SIGNUP_ENABLED") !== "on") ||
        !validId(appId) || !validId(configId) || !appSecret || !graphVersion || !/^v\d+\.\d+$/.test(graphVersion) || !key) {
      throw new ForbiddenError("School WhatsApp account management is unavailable.");
    }
    return { graph: { appId, appSecret, configId, graphVersion }, key };
  }

  async begin(auth: AuthContext) {
    await assertUserActiveAndHasOneOf(auth, ["owner"]);
    const { graph } = this.settings(true);
    const state = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await withTenant(auth.schoolId, async (db) => {
      await this.lockSchool(db, auth.schoolId, true);
      const connection = await db.messagingSchoolMetaConnection.findUnique({ where: { schoolId: auth.schoolId } });
      if (connection?.encryptedToken) throw new ConflictError("META_CONNECTION_EXISTS", "Disconnect the current account first.");
      await db.messagingMetaSignupSession.upsert({
        where: { schoolId: auth.schoolId },
        create: { schoolId: auth.schoolId, ownerId: auth.userId, stateHash: stateHash(state), expiresAt },
        update: { ownerId: auth.userId, stateHash: stateHash(state), expiresAt, claimedAt: null },
      });
    });
    return { appId: graph.appId, configId: graph.configId, graphVersion: graph.graphVersion, state, expiresAt: expiresAt.toISOString() };
  }

  async complete(auth: AuthContext, input: MetaSignupInput): Promise<{ status: "CONNECTED"; billing: "SCHOOL_OWNED" }> {
    await assertUserActiveAndHasOneOf(auth, ["owner"]);
    const { graph, key } = this.settings(true);
    if (!validId(input.wabaId) || !validId(input.phoneNumberId) || !/^[A-Za-z0-9_-]{43}$/.test(input.state) ||
        !input.code || input.code.length > 2048) throw new ValidationError("Invalid Meta signup response.");
    const claim = { schoolId: auth.schoolId, ownerId: auth.userId, stateHash: stateHash(input.state) };
    const count = await withTenant(auth.schoolId, (db) => db.messagingMetaSignupSession.updateMany({
      where: { ...claim, claimedAt: null, expiresAt: { gt: new Date() } },
      data: { claimedAt: new Date() },
    }));
    if (count.count !== 1) throw new ConflictError("META_SIGNUP_STATE_INVALID", "Start a new Meta signup session.");

    let verified: Awaited<ReturnType<typeof verifyMetaSignup>>;
    try {
      verified = await verifyMetaSignup(graph, input);
    } catch {
      throw new ValidationError("Meta could not verify the requested business and phone.");
    }

    const { token, displayPhone } = verified;
    const encryptedToken = sealMetaToken(key, auth.schoolId, input.wabaId, token);
    try {
      // Reserve the WABA and phone before subscribing. Keep the connection
      // disabled until the provider has accepted the subscription.
      await withTenant(auth.schoolId, async (db) => {
        await this.lockSchool(db, auth.schoolId, true);
        const consumed = await db.messagingMetaSignupSession.deleteMany({ where: { ...claim, expiresAt: { gt: new Date() } } });
        if (consumed.count !== 1) throw new ConflictError("META_SIGNUP_STATE_INVALID", "Start a new Meta signup session.");
        const current = await db.messagingSchoolMetaConnection.findUnique({ where: { schoolId: auth.schoolId } });
        if (current?.encryptedToken) throw new ConflictError("META_CONNECTION_EXISTS", "Disconnect the current account first.");
        const occupied = await db.messagingMetaAccount.findFirst({
          where: {
            schoolId: { not: auth.schoolId },
            OR: [{ wabaId: input.wabaId }, { phoneNumberId: input.phoneNumberId }],
          },
          select: { schoolId: true },
        });
        if (occupied) throw new ConflictError("META_ACCOUNT_UNAVAILABLE", "The requested account is unavailable.");
        const data = {
          wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, encryptedToken, displayPhone,
          activationPending: true, disconnectedAt: new Date(), revokedAt: null,
        };
        await db.messagingSchoolMetaConnection.upsert({
          where: { schoolId: auth.schoolId }, create: { ...data, schoolId: auth.schoolId }, update: data,
        });
      });
      if (!(await manageMetaSubscription(graph, input.wabaId, token, "POST"))) {
        throw new Error("Meta did not confirm the subscription");
      }
      await withTenant(auth.schoolId, async (db) => {
        await this.lockSchool(db, auth.schoolId, true);
        const current = await db.messagingSchoolMetaConnection.updateMany({
          where: { schoolId: auth.schoolId, encryptedToken, revokedAt: null, activationPending: true },
          data: { disconnectedAt: null, activationPending: false, connectedAt: new Date() },
        });
        if (current.count !== 1) throw new ConflictError("META_CONNECTION_CHANGED", "The WhatsApp connection changed during signup.");
        const binding = { wabaId: input.wabaId, phoneNumberId: input.phoneNumberId };
        await db.messagingMetaAccount.upsert({
          where: { schoolId: auth.schoolId }, create: { ...binding, schoolId: auth.schoolId }, update: binding,
        });
        await db.auditLog.create({ data: {
          schoolId: auth.schoolId, userId: auth.userId, action: "messaging.meta.connect",
          entityType: "messaging_meta_connection", entityId: auth.schoolId,
        } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError("META_ACCOUNT_UNAVAILABLE", "The requested account is unavailable.");
      }
      if (error instanceof ConflictError) throw error;
      throw new ConflictError("META_SUBSCRIPTION_UNCONFIRMED", "The account is disabled. Disconnect it before retrying signup.");
    }
    return { status: "CONNECTED", billing: "SCHOOL_OWNED" };
  }

  /** Internal only. Never return the token through an HTTP handler. */
  async activeAccount(schoolId: string) {
    const connection = await withTenant(schoolId, (db) => db.messagingSchoolMetaConnection.findFirst({
      where: {
        schoolId, disconnectedAt: null, activationPending: false, encryptedToken: { not: null },
        school: { status: "ACTIVE", suspendedAt: null, deletionStartedAt: null },
      },
    }));
    if (!connection?.encryptedToken) return undefined;
    try {
      const settings = this.settings(false);
      return {
        wabaId: connection.wabaId, phoneNumberId: connection.phoneNumberId,
        token: openMetaToken(settings.key, schoolId, connection.wabaId, connection.encryptedToken),
        graphVersion: settings.graph.graphVersion, billing: "SCHOOL_OWNED" as const,
      };
    } catch {
      return undefined;
    }
  }

  async disconnect(auth: AuthContext): Promise<{ status: "DISCONNECTED"; revocationPending: boolean }> {
    await assertUserActiveAndHasOneOf(auth, ["owner"]);
    const current = await withTenant(auth.schoolId, async (db) => {
      await this.lockSchool(db, auth.schoolId, false);
      await db.messagingMetaSignupSession.deleteMany({ where: { schoolId: auth.schoolId } });
      const connection = await db.messagingSchoolMetaConnection.findUnique({ where: { schoolId: auth.schoolId } });
      // Leave legacy manually provisioned bindings intact. This endpoint
      // owns only bindings created by Embedded Signup.
      if (!connection) return null;
      await db.messagingMetaAccount.deleteMany({
        where: { schoolId: auth.schoolId, wabaId: connection.wabaId, phoneNumberId: connection.phoneNumberId },
      });
      await db.messagingSchoolMetaConnection.updateMany({
        where: { schoolId: auth.schoolId }, data: { disconnectedAt: new Date(), activationPending: false },
      });
      await db.messagingGuardianConsent.updateMany({
        where: { schoolId: auth.schoolId },
        data: { withdrawnAt: new Date(), challengeHash: null, challengeExpiresAt: null, challengeIssuedAt: null },
      });
      return connection;
    });
    if (!current?.encryptedToken) return { status: "DISCONNECTED", revocationPending: false };

    try {
      const { graph, key } = this.settings(false);
      const token = openMetaToken(key, auth.schoolId, current.wabaId, current.encryptedToken);
      await manageMetaSubscription(graph, current.wabaId, token, "DELETE").catch(() => false);
      if (!(await revokeMetaToken(graph, token))) return { status: "DISCONNECTED", revocationPending: true };
      await withTenant(auth.schoolId, async (db) => {
        const updated = await db.messagingSchoolMetaConnection.updateMany({
          where: { schoolId: auth.schoolId, encryptedToken: current.encryptedToken, disconnectedAt: { not: null } },
          data: { encryptedToken: null, revokedAt: new Date() },
        });
        if (updated.count) {
          await db.auditLog.create({ data: {
            schoolId: auth.schoolId, userId: auth.userId, action: "messaging.meta.revoke",
            entityType: "messaging_meta_connection", entityId: auth.schoolId,
          } });
        }
      });
      return { status: "DISCONNECTED", revocationPending: false };
    } catch {
      return { status: "DISCONNECTED", revocationPending: true };
    }
  }

  private async lockSchool(db: PrismaClient, schoolId: string, active: boolean) {
    const [school] = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM schools WHERE id = ${schoolId} AND deletion_started_at IS NULL
        AND (NOT ${active} OR (status = 'ACTIVE' AND suspended_at IS NULL)) FOR UPDATE`;
    if (!school) throw new ForbiddenError("School account management is unavailable.");
  }
}
