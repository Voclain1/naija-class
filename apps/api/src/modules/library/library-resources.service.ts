import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type CreateResourceFileInput,
  type CreateResourceLinkInput,
  type LibraryResourceDto,
  type LibraryResourceListDto,
  type LibraryResourceScopeDto,
  type LibraryResourceUrlDto,
  type ListResourcesInput,
  type StudentLibraryResourcesDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { getActiveUserRoleKeys } from "../../common/auth/role-check.js";
import { assertPrivateFile, PRIVATE_FILE_URL_TTL_SECONDS } from "../../common/storage/private-file.js";
import { StorageService } from "../../common/storage/storage.service.js";
import { getTeacherScope } from "../teacher-scope/teacher-scope.helper.js";

// Phase 9 / CP6.3 — digital resources (docs/modules/phase-9.md §14 CP6-D7).
//
// A PDF (F1: typed by its own bytes, at most 10 MB, stored privately) or an
// https link, for one subject and one or more class levels.
//
// TWO GATES, as the question bank has: @Permissions authorises the role
// (library.resource.read / .write: owner, admin, Librarian, teacher) and this
// service scopes the row. The Librarian, owner and admin add and remove any; a
// teacher adds only for a subject they teach at EVERY level chosen
// (getTeacherScope's level-and-subject pairs) and removes only their own.
//
// STUDENTS see a resource when they are enrolled this term in an arm of one of
// its levels. A PDF opens through a five-minute signed link, issued only after
// that same check; a link opens in the browser. Parents do not see resources:
// they are the child's reading, not a record about the child.
//
// Adding and removing are audited; opening is not (teaching material, not a
// record about anyone).

const ANY_ROLES = ["owner", "admin", "librarian"] as const;
const STAFF_ROLES = [...ANY_ROLES, "teacher"] as const;

const AUDIT = { create: "library.resource.create", remove: "library.resource.remove" } as const;

type Db = PrismaClient;
interface RequestContext {
  ipAddress: string | null;
}

const RESOURCE_INCLUDE = {
  subject: { select: { id: true, name: true } },
  levels: { select: { classLevel: { select: { id: true, name: true, orderIndex: true } } } },
} satisfies Prisma.LibraryResourceInclude;
type ResourceRow = Prisma.LibraryResourceGetPayload<{ include: typeof RESOURCE_INCLUDE }>;

/** Who is asking: free to add anywhere, or held to the pairs they teach. */
interface Actor {
  any: boolean;
  pairs: Set<string>;
}
const pairKey = (subjectId: string, classLevelId: string) => `${subjectId}:${classLevelId}`;

@Injectable()
export class LibraryResourcesService {
  constructor(private readonly storage: StorageService) {}

  async list(authCtx: AuthContext, query: ListResourcesInput): Promise<LibraryResourceListDto> {
    const actor = await this.actor(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.libraryResource.findMany({
        where: {
          schoolId: authCtx.schoolId,
          ...(query.subjectId ? { subjectId: query.subjectId } : {}),
          ...(query.classLevelId ? { levels: { some: { classLevelId: query.classLevelId } } } : {}),
        },
        include: RESOURCE_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: 300,
      });
      const names = await staffNames(db, rows.map((r) => r.addedBy));
      return {
        resources: rows.map((r) => resourceDto(r, names, actor.any || r.addedBy === authCtx.userId)),
        scope: await this.scopeDto(db, authCtx.schoolId, actor),
      };
    });
  }

  async createLink(authCtx: AuthContext, input: CreateResourceLinkInput, req: RequestContext): Promise<LibraryResourceDto> {
    const actor = await this.actor(authCtx);
    if (!/^https:\/\//.test(input.url)) throw new ValidationError("LINK_NOT_HTTPS", "The address must start with https://");
    return withTenant(authCtx.schoolId, async (db) => {
      await assertAllowed(db, authCtx.schoolId, actor, input.subjectId, input.levelIds);
      const row = await insert(db, authCtx, randomUUID(), input, { kind: "LINK", url: input.url });
      await audit(db, authCtx, req, AUDIT.create, row.id, { kind: "LINK", levels: input.levelIds.length });
      return resourceDto(row, await staffNames(db, [row.addedBy]), true);
    });
  }

  async createFile(authCtx: AuthContext, input: CreateResourceFileInput, buffer: Buffer, req: RequestContext): Promise<LibraryResourceDto> {
    const actor = await this.actor(authCtx);
    const kind = assertPrivateFile(buffer);
    if (kind.ext !== "pdf") throw new ValidationError("INVALID_FILE_TYPE", "Upload a PDF.");
    await withTenant(authCtx.schoolId, (db) => assertAllowed(db, authCtx.schoolId, actor, input.subjectId, input.levelIds));
    const id = randomUUID();
    await this.storage.put(authCtx.schoolId, { kind: "library-resource", resourceId: id, ext: "pdf" }, buffer, kind.mime);
    try {
      return await withTenant(authCtx.schoolId, async (db) => {
        const row = await insert(db, authCtx, id, input, { kind: "FILE", fileExt: "pdf", fileSize: buffer.length });
        await audit(db, authCtx, req, AUDIT.create, id, { kind: "FILE", size: buffer.length, levels: input.levelIds.length });
        return resourceDto(row, await staffNames(db, [row.addedBy]), true);
      });
    } catch (e) {
      // The row did not land: take the stored file back out.
      await this.storage.delete(authCtx.schoolId, { kind: "library-resource", resourceId: id, ext: "pdf" }).catch(() => undefined);
      throw e;
    }
  }

  async remove(authCtx: AuthContext, id: string, req: RequestContext): Promise<void> {
    const actor = await this.actor(authCtx);
    const removed = await withTenant(authCtx.schoolId, async (db) => {
      const row = await db.libraryResource.findFirst({ where: { id, schoolId: authCtx.schoolId }, select: { id: true, kind: true, addedBy: true } });
      if (!row) throw new NotFoundError("Resource not found.");
      if (!actor.any && row.addedBy !== authCtx.userId) throw new ForbiddenError("You can remove only the resources you added.");
      await db.libraryResource.delete({ where: { id } });
      await audit(db, authCtx, req, AUDIT.remove, id, { kind: row.kind });
      return row;
    });
    if (removed.kind === "FILE") {
      await this.storage.delete(authCtx.schoolId, { kind: "library-resource", resourceId: id, ext: "pdf" }).catch(() => undefined);
    }
  }

  /** GET /library/resources/:id/file — staff open a PDF. */
  async fileUrlForStaff(authCtx: AuthContext, id: string): Promise<LibraryResourceUrlDto> {
    await this.actor(authCtx);
    const row = await withTenant(authCtx.schoolId, (db) =>
      db.libraryResource.findFirst({ where: { id, schoolId: authCtx.schoolId, kind: "FILE" }, select: { id: true } }),
    );
    if (!row) throw new NotFoundError("There is no file for that resource.");
    return { url: await this.sign(authCtx.schoolId, id) };
  }

  // ─── Students ─────────────────────────────────────────────────────────────

  /** GET /student-portal/me/library/resources — what is meant for the child's class level. */
  async forStudent(schoolId: string, studentId: string): Promise<StudentLibraryResourcesDto> {
    return withTenant(schoolId, async (db) => {
      const levelIds = await studentLevels(db, schoolId, studentId);
      if (levelIds.length === 0) return { resources: [] };
      const rows = await db.libraryResource.findMany({
        where: { schoolId, levels: { some: { classLevelId: { in: levelIds } } } },
        include: { subject: { select: { name: true } } },
        orderBy: [{ subject: { name: "asc" } }, { createdAt: "desc" }],
        take: 300,
      });
      return {
        resources: rows.map((r) => ({ id: r.id, title: r.title, description: r.description, subjectName: r.subject.name, kind: r.kind, url: r.url })),
      };
    });
  }

  /** GET /student-portal/me/library/resources/:id/file — a five-minute link, after the level check. */
  async fileUrlForStudent(schoolId: string, studentId: string, id: string): Promise<LibraryResourceUrlDto> {
    const row = await withTenant(schoolId, async (db) => {
      const levelIds = await studentLevels(db, schoolId, studentId);
      return db.libraryResource.findFirst({
        where: { id, schoolId, kind: "FILE", levels: { some: { classLevelId: { in: levelIds } } } },
        select: { id: true },
      });
    });
    if (!row) throw new NotFoundError("There is no file for that resource.");
    return { url: await this.sign(schoolId, id) };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async actor(authCtx: AuthContext): Promise<Actor> {
    const roles = await getActiveUserRoleKeys(authCtx);
    if (roles.some((r) => (ANY_ROLES as readonly string[]).includes(r))) return { any: true, pairs: new Set() };
    if (!roles.includes("teacher")) {
      throw new ForbiddenError(`This action requires one of the following roles: ${STAFF_ROLES.join(", ")}.`);
    }
    const scope = await withTenant(authCtx.schoolId, (db) => getTeacherScope(db as never, authCtx.userId));
    const pairs = new Set<string>();
    for (const arm of scope.classArms) {
      for (const subject of scope.subjectsByArm.get(arm.id) ?? []) pairs.add(pairKey(subject.id, arm.classLevelId));
    }
    return { any: false, pairs };
  }

  private async scopeDto(db: Db, schoolId: string, actor: Actor): Promise<LibraryResourceScopeDto> {
    const [subjects, levels] = await Promise.all([
      db.subject.findMany({ where: { schoolId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      db.classLevel.findMany({ where: { schoolId }, select: { id: true, name: true }, orderBy: { orderIndex: "asc" } }),
    ]);
    if (actor.any) return { any: true, subjects, levels, pairs: [] };
    const pairs = [...actor.pairs].map((k) => {
      const [subjectId, classLevelId] = k.split(":") as [string, string];
      return { subjectId, classLevelId };
    });
    const subjectIds = new Set(pairs.map((p) => p.subjectId));
    const levelIds = new Set(pairs.map((p) => p.classLevelId));
    return { any: false, subjects: subjects.filter((s) => subjectIds.has(s.id)), levels: levels.filter((l) => levelIds.has(l.id)), pairs };
  }

  private sign(schoolId: string, id: string): Promise<string> {
    return this.storage.signUrl(schoolId, { kind: "library-resource", resourceId: id, ext: "pdf" }, PRIVATE_FILE_URL_TTL_SECONDS);
  }
}

async function assertAllowed(db: Db, schoolId: string, actor: Actor, subjectId: string, levelIds: string[]): Promise<void> {
  const unique = [...new Set(levelIds)];
  const [subject, levels] = await Promise.all([
    db.subject.count({ where: { id: subjectId, schoolId } }),
    db.classLevel.count({ where: { id: { in: unique }, schoolId } }),
  ]);
  if (subject === 0) throw new ValidationError("UNKNOWN_SUBJECT", "That subject is not in this school.");
  if (unique.length === 0 || levels !== unique.length) throw new ValidationError("UNKNOWN_CLASS_LEVEL", "A class level is not in this school.");
  if (!actor.any && !unique.every((l) => actor.pairs.has(pairKey(subjectId, l)))) {
    throw new ForbiddenError("You can add resources only for a subject you teach, at the classes you teach it.");
  }
}

async function insert(
  db: Db,
  authCtx: AuthContext,
  id: string,
  input: CreateResourceFileInput,
  body: { kind: "LINK"; url: string } | { kind: "FILE"; fileExt: "pdf"; fileSize: number },
): Promise<ResourceRow> {
  return db.libraryResource.create({
    data: {
      id,
      schoolId: authCtx.schoolId,
      title: input.title,
      description: input.description ?? null,
      subjectId: input.subjectId,
      addedBy: authCtx.userId,
      ...body,
      levels: { create: [...new Set(input.levelIds)].map((classLevelId) => ({ schoolId: authCtx.schoolId, classLevelId })) },
    },
    include: RESOURCE_INCLUDE,
  });
}

/** The class levels a student is enrolled at this term. */
async function studentLevels(db: Db, schoolId: string, studentId: string): Promise<string[]> {
  const term = await db.term.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true } });
  if (!term) return [];
  const rows = await db.enrollment.findMany({
    where: { schoolId, studentId, termId: term.id, status: "ENROLLED" },
    select: { classArm: { select: { classLevelId: true } } },
  });
  return [...new Set(rows.map((r) => r.classArm.classLevelId))];
}

async function staffNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
}

function resourceDto(row: ResourceRow, names: Map<string, string>, canRemove: boolean): LibraryResourceDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    subject: row.subject,
    levels: [...row.levels].sort((a, b) => a.classLevel.orderIndex - b.classLevel.orderIndex).map((l) => ({ id: l.classLevel.id, name: l.classLevel.name })),
    kind: row.kind,
    url: row.url,
    fileSize: row.fileSize,
    addedBy: { id: row.addedBy, name: names.get(row.addedBy) ?? "A former member of staff" },
    createdAt: row.createdAt.toISOString(),
    canRemove,
  };
}

async function audit(db: Db, authCtx: AuthContext, req: RequestContext, action: string, entityId: string, metadata: Record<string, string | number>) {
  await db.auditLog.create({
    data: { schoolId: authCtx.schoolId, userId: authCtx.userId, action, entityType: "library_resource", entityId, ipAddress: req.ipAddress, metadata },
  });
}
