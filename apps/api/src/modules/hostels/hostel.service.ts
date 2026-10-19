import { Injectable, Optional } from "@nestjs/common";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type CopyBedsInput,
  type CopyBedsResultDto,
  type CreateBedInput,
  type CreateHostelInput,
  type HostelBedDto,
  type HostelDto,
  type HostelGender,
  type HouseMasterCandidateDto,
  type ListBedsInput,
  type ListHostelsInput,
  type MoveBedInput,
  type RoomInput,
  type SetHostelFeeInput,
  type SetHostelFeeResultDto,
  type SetHouseMastersInput,
  type StudentHostelDto,
  type UpdateHostelInput,
  type UpdateRoomInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { StudentChargeService, type ChargeActor } from "../finance/student-charge.service.js";

// Phase 9 / CP6b.1 — hostels, rooms and beds (docs/modules/phase-9.md §15,
// owner's answers §15.8). The shape transport proved in CP5.2.
//
// BEDS. A student holds one bed a term — that is what makes them a boarder —
// and a bed holds one student a term (two unique indexes). The room row is
// locked (SELECT … FOR UPDATE) while a bed is chosen, so two staff taking the
// last bed at once cannot both succeed. A hostel is for boys or for girls, and
// a child is placed only in one for their recorded gender.
//
// MONEY. A bed in a hostel that charges a fee raises one HOSTEL student charge
// for that term, through StudentChargeService (source "hostel", the bed's id)
// — never a write of our own. The fee belongs to the hostel and stands for
// every later term and session until changed (owner, §15.8). A move keeps the
// one charge: still waiting, it takes the new hostel's fee; billed, it stays.
// A removal, or a move to a free hostel, voids a waiting charge and leaves a
// billed one. A fee change re-prices the waiting charges of this and later
// terms. No pro-rating.

const READ_ROLES = ["owner", "admin", "bursar"] as const;
const MANAGE_ROLES = ["owner", "admin"] as const;
const FEE_ROLES = ["owner", "admin", "bursar"] as const;
/** Who may be a house master: a teacher, or the optional House master role (§15.8). */
const HOUSE_MASTER_ROLE_KEYS = ["teacher", "house_master"] as const;
const SOURCE = "hostel";

const AUDIT = {
  hostel: "hostel.hostel",
  room: "hostel.room",
  fee: "hostel.fee",
  houseMasters: "hostel.house_masters",
  place: "hostel.bed.place",
  move: "hostel.bed.move",
  remove: "hostel.bed.remove",
  copy: "hostel.bed.copy",
} as const;

type Db = PrismaClient;
interface RequestContext {
  ipAddress: string | null;
}

const HOSTEL_INCLUDE = {
  houseMasters: { select: { user: { select: { id: true, firstName: true, lastName: true } } } },
  rooms: { orderBy: { name: "asc" as const }, select: { id: true, name: true, beds: true } },
} satisfies Prisma.HostelInclude;
type HostelRow = Prisma.HostelGetPayload<{ include: typeof HOSTEL_INCLUDE }>;

@Injectable()
export class HostelService {
  constructor(@Optional() private readonly charges: StudentChargeService = new StudentChargeService()) {}

  // ─── Hostels ──────────────────────────────────────────────────────────────

  async listHostels(authCtx: AuthContext, query: ListHostelsInput): Promise<HostelDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, READ_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.hostel.findMany({ where: { schoolId: authCtx.schoolId }, include: HOSTEL_INCLUDE, orderBy: { name: "asc" } });
      const taken = await bedsTaken(db, authCtx.schoolId, query.termId);
      return rows.map((r) => hostelDto(r, taken));
    });
  }

  async getHostel(authCtx: AuthContext, id: string, query: ListHostelsInput): Promise<HostelDto> {
    await assertUserActiveAndHasOneOf(authCtx, READ_ROLES);
    return withTenant(authCtx.schoolId, (db) => readHostel(db, authCtx.schoolId, id, query.termId));
  }

  async createHostel(authCtx: AuthContext, input: CreateHostelInput, req: RequestContext): Promise<HostelDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await uniqueOr("HOSTEL_EXISTS", "A hostel with this name already exists.", () =>
        db.hostel.create({ data: { schoolId: authCtx.schoolId, name: input.name, forGender: input.forGender } }),
      );
      await audit(db, authCtx, req, AUDIT.hostel, row.id, { op: "create", forGender: input.forGender });
      return readHostel(db, authCtx.schoolId, row.id, undefined);
    });
  }

  async updateHostel(authCtx: AuthContext, id: string, input: UpdateHostelInput, req: RequestContext): Promise<HostelDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const hostel = await lockHostel(db, authCtx.schoolId, id);
      if (input.forGender !== undefined && input.forGender !== hostel.for_gender) {
        const boarders = await db.hostelBed.count({ where: { hostelId: id, termId: { in: await currentAndLaterTermIds(db, authCtx.schoolId) } } });
        if (boarders > 0) {
          throw new ConflictError("HOSTEL_HAS_BOARDERS", "This hostel has boarders this term or later, so it cannot change between boys and girls.");
        }
      }
      await uniqueOr("HOSTEL_EXISTS", "A hostel with this name already exists.", () =>
        db.hostel.update({
          where: { id },
          data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.forGender !== undefined ? { forGender: input.forGender } : {}) },
        }),
      );
      await audit(db, authCtx, req, AUDIT.hostel, id, { op: "update" });
      return readHostel(db, authCtx.schoolId, id, undefined);
    });
  }

  /** Only a hostel no child has ever slept in: its beds are the boarding record. */
  async deleteHostel(authCtx: AuthContext, id: string, req: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    await withTenant(authCtx.schoolId, async (db) => {
      await lockHostel(db, authCtx.schoolId, id);
      if ((await db.hostelBed.count({ where: { hostelId: id } })) > 0) {
        throw new ConflictError("HOSTEL_IN_USE", "Children have had beds in this hostel, so it stays in the records.");
      }
      await db.hostel.delete({ where: { id } });
      await audit(db, authCtx, req, AUDIT.hostel, id, { op: "delete" });
    });
  }

  /**
   * The hostel's fee, set on its own page. It stands for later terms and
   * sessions until changed; waiting charges for this and later terms take the
   * new fee, billed ones keep theirs.
   */
  async setFee(authCtx: AuthContext, id: string, input: SetHostelFeeInput, req: RequestContext): Promise<SetHostelFeeResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, FEE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const hostel = await lockHostel(db, authCtx.schoolId, id);
      await db.hostel.update({ where: { id }, data: { fee: input.fee } });
      const beds = await db.hostelBed.findMany({
        where: { hostelId: id, termId: { in: await currentAndLaterTermIds(db, authCtx.schoolId) } },
        select: { id: true, studentId: true, termId: true },
      });
      const actor = chargeActor(authCtx, req);
      const result = { repriced: 0, raised: 0, voided: 0, keptBilled: 0 };
      for (const bed of beds) {
        const outcome = await this.chargeFor(db, actor, bed, hostel.name, input.fee, "The hostel became free");
        if (outcome !== "none") result[outcome] += 1;
      }
      await audit(db, authCtx, req, AUDIT.fee, id, { from: hostel.fee, to: input.fee, ...result });
      return { hostel: await readHostel(db, authCtx.schoolId, id, undefined), ...result };
    });
  }

  /** Staff who may be made house masters: teachers and House masters (§15.8). */
  async houseMasterCandidates(authCtx: AuthContext): Promise<HouseMasterCandidateDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const users = await candidateUsers(db, authCtx.schoolId);
      return users.map((u) => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        role: u.roles.some((r) => r.role.key === "house_master") ? "House master" : "Teacher",
      }));
    });
  }

  async setHouseMasters(authCtx: AuthContext, id: string, input: SetHouseMastersInput, req: RequestContext): Promise<HostelDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      await lockHostel(db, authCtx.schoolId, id);
      const wanted = [...new Set(input.userIds)];
      const allowed = new Set((await candidateUsers(db, authCtx.schoolId)).map((u) => u.id));
      if (!wanted.every((u) => allowed.has(u))) {
        throw new ValidationError("NOT_A_HOUSE_MASTER", "A house master must be an active teacher or House master of this school.");
      }
      await db.hostelHouseMaster.deleteMany({ where: { hostelId: id } });
      if (wanted.length > 0) {
        await db.hostelHouseMaster.createMany({ data: wanted.map((userId) => ({ schoolId: authCtx.schoolId, hostelId: id, userId })) });
      }
      await audit(db, authCtx, req, AUDIT.houseMasters, id, { count: wanted.length });
      return readHostel(db, authCtx.schoolId, id, undefined);
    });
  }

  // ─── Rooms ────────────────────────────────────────────────────────────────

  async createRoom(authCtx: AuthContext, hostelId: string, input: RoomInput, req: RequestContext): Promise<HostelDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      await lockHostel(db, authCtx.schoolId, hostelId);
      const room = await uniqueOr("ROOM_EXISTS", "This hostel already has a room with that name.", () =>
        db.hostelRoom.create({ data: { schoolId: authCtx.schoolId, hostelId, name: input.name, beds: input.beds } }),
      );
      await audit(db, authCtx, req, AUDIT.room, room.id, { op: "create", hostelId, beds: input.beds });
      return readHostel(db, authCtx.schoolId, hostelId, undefined);
    });
  }

  async updateRoom(authCtx: AuthContext, roomId: string, input: UpdateRoomInput, req: RequestContext): Promise<HostelDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const room = await lockRoom(db, authCtx.schoolId, roomId);
      if (input.beds !== undefined && input.beds < room.beds) {
        const highest = await db.hostelBed.aggregate({
          where: { roomId, termId: { in: await currentAndLaterTermIds(db, authCtx.schoolId) } },
          _max: { bedNumber: true },
        });
        if ((highest._max.bedNumber ?? 0) > input.beds) {
          throw new ConflictError("ROOM_TOO_SMALL", `A child sleeps in bed ${highest._max.bedNumber} this term or later. Move them first.`);
        }
      }
      await uniqueOr("ROOM_EXISTS", "This hostel already has a room with that name.", () =>
        db.hostelRoom.update({
          where: { id: roomId },
          data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.beds !== undefined ? { beds: input.beds } : {}) },
        }),
      );
      await audit(db, authCtx, req, AUDIT.room, roomId, { op: "update", beds: input.beds ?? room.beds });
      return readHostel(db, authCtx.schoolId, room.hostel_id, undefined);
    });
  }

  async deleteRoom(authCtx: AuthContext, roomId: string, req: RequestContext): Promise<HostelDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const room = await lockRoom(db, authCtx.schoolId, roomId);
      if ((await db.hostelBed.count({ where: { roomId } })) > 0) {
        throw new ConflictError("ROOM_IN_USE", "Children have had beds in this room, so it stays in the records.");
      }
      await db.hostelRoom.delete({ where: { id: roomId } });
      await audit(db, authCtx, req, AUDIT.room, roomId, { op: "delete" });
      return readHostel(db, authCtx.schoolId, room.hostel_id, undefined);
    });
  }

  // ─── Beds ─────────────────────────────────────────────────────────────────

  async listBeds(authCtx: AuthContext, hostelId: string, query: ListBedsInput): Promise<HostelBedDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, READ_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const hostel = await db.hostel.findFirst({ where: { id: hostelId, schoolId: authCtx.schoolId }, select: { id: true } });
      if (!hostel) throw new NotFoundError("Hostel not found.");
      const rows = await db.hostelBed.findMany({ where: { hostelId, termId: query.termId }, select: { id: true } });
      return readBeds(db, authCtx.schoolId, rows.map((r) => r.id));
    });
  }

  async placeStudent(authCtx: AuthContext, input: CreateBedInput, req: RequestContext): Promise<HostelBedDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const [student, term] = await Promise.all([
        db.student.findFirst({ where: { id: input.studentId, schoolId: authCtx.schoolId }, select: { status: true, gender: true } }),
        db.term.findFirst({ where: { id: input.termId, schoolId: authCtx.schoolId }, select: { id: true } }),
      ]);
      if (!student) throw new NotFoundError("Student not found.");
      if (!term) throw new NotFoundError("Term not found.");
      if (student.status === "WITHDRAWN" || student.status === "GRADUATED") {
        throw new ConflictError("STUDENT_LEFT", "This student has left the school.");
      }
      const room = await lockRoom(db, authCtx.schoolId, input.roomId);
      const hostel = await db.hostel.findUniqueOrThrow({ where: { id: room.hostel_id }, select: { id: true, name: true, fee: true, forGender: true } });
      assertGender(student.gender, hostel.forGender);
      const bedNumber = await chooseBed(db, room, input.termId, input.bedNumber);
      const bed = await uniqueOr("ALREADY_PLACED", "This student already has a bed this term.", () =>
        db.hostelBed.create({
          data: { schoolId: authCtx.schoolId, studentId: input.studentId, termId: input.termId, hostelId: hostel.id, roomId: input.roomId, bedNumber, createdBy: authCtx.userId },
        }),
      );
      await this.chargeFor(db, chargeActor(authCtx, req), bed, hostel.name, hostel.fee, "");
      await audit(db, authCtx, req, AUDIT.place, bed.id, { studentId: input.studentId, termId: input.termId, roomId: input.roomId, bedNumber });
      return (await readBeds(db, authCtx.schoolId, [bed.id]))[0]!;
    });
  }

  async moveStudent(authCtx: AuthContext, id: string, input: MoveBedInput, req: RequestContext): Promise<HostelBedDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const bed = await db.hostelBed.findFirst({ where: { id, schoolId: authCtx.schoolId }, include: { student: { select: { gender: true } } } });
      if (!bed) throw new NotFoundError("Bed not found.");
      // Lock both rooms in id order, so two crossing moves cannot deadlock.
      const locked = new Map<string, LockedRoom>();
      for (const roomId of [...new Set([bed.roomId, input.roomId])].sort()) locked.set(roomId, await lockRoom(db, authCtx.schoolId, roomId));
      const target = locked.get(input.roomId)!;
      const hostel = await db.hostel.findUniqueOrThrow({ where: { id: target.hostel_id }, select: { id: true, name: true, fee: true, forGender: true } });
      assertGender(bed.student.gender, hostel.forGender);
      const bedNumber = await chooseBed(db, target, bed.termId, input.bedNumber, bed.id);
      await uniqueOr("BED_TAKEN", "That bed is taken this term.", () =>
        db.hostelBed.update({ where: { id }, data: { hostelId: hostel.id, roomId: input.roomId, bedNumber } }),
      );
      if (hostel.id !== bed.hostelId) {
        await this.chargeFor(db, chargeActor(authCtx, req), bed, hostel.name, hostel.fee, "Moved to a hostel without a fee");
      }
      await audit(db, authCtx, req, AUDIT.move, id, { fromRoomId: bed.roomId, toRoomId: input.roomId, bedNumber });
      return (await readBeds(db, authCtx.schoolId, [id]))[0]!;
    });
  }

  async removeStudent(authCtx: AuthContext, id: string, req: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    await withTenant(authCtx.schoolId, async (db) => {
      const bed = await db.hostelBed.findFirst({ where: { id, schoolId: authCtx.schoolId } });
      if (!bed) throw new NotFoundError("Bed not found.");
      await removeBedAndCharge(db, this.charges, chargeActor(authCtx, req), id, "Removed from the hostel");
      await audit(db, authCtx, req, AUDIT.remove, id, { studentId: bed.studentId, termId: bed.termId, roomId: bed.roomId });
    });
  }

  /**
   * Next term (or the first term of a new session): every boarder in the same
   * bed where it is free, at each hostel's fee as it stands.
   */
  async copyBeds(authCtx: AuthContext, input: CopyBedsInput, req: RequestContext): Promise<CopyBedsResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const terms = await db.term.count({ where: { schoolId: authCtx.schoolId, id: { in: [input.fromTermId, input.toTermId] } } });
      if (terms !== 2) throw new NotFoundError("Term not found.");
      const from = await db.hostelBed.findMany({
        where: { schoolId: authCtx.schoolId, termId: input.fromTermId },
        include: { student: { select: { status: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const rooms = new Map<string, LockedRoom>();
      for (const roomId of [...new Set(from.map((b) => b.roomId))].sort()) rooms.set(roomId, await lockRoom(db, authCtx.schoolId, roomId));
      const hostels = new Map(
        (await db.hostel.findMany({ where: { id: { in: [...new Set(from.map((b) => b.hostelId))] } }, select: { id: true, name: true, fee: true } })).map((h) => [h.id, h]),
      );
      const next = await db.hostelBed.findMany({ where: { schoolId: authCtx.schoolId, termId: input.toTermId }, select: { studentId: true, roomId: true, bedNumber: true } });
      const placed = new Set(next.map((b) => b.studentId));
      const takenBeds = new Set(next.map((b) => `${b.roomId}:${b.bedNumber}`));
      const result: CopyBedsResultDto = { copied: 0, alreadyPlaced: 0, bedTaken: 0, leftSchool: 0 };
      const actor = chargeActor(authCtx, req);
      for (const b of from) {
        if (b.student.status === "WITHDRAWN" || b.student.status === "GRADUATED") {
          result.leftSchool += 1;
          continue;
        }
        if (placed.has(b.studentId)) {
          result.alreadyPlaced += 1;
          continue;
        }
        if (takenBeds.has(`${b.roomId}:${b.bedNumber}`) || b.bedNumber > rooms.get(b.roomId)!.beds) {
          result.bedTaken += 1;
          continue;
        }
        const copy = await db.hostelBed.create({
          data: { schoolId: authCtx.schoolId, studentId: b.studentId, termId: input.toTermId, hostelId: b.hostelId, roomId: b.roomId, bedNumber: b.bedNumber, createdBy: authCtx.userId },
        });
        takenBeds.add(`${b.roomId}:${b.bedNumber}`);
        placed.add(b.studentId);
        const hostel = hostels.get(b.hostelId)!;
        await this.chargeFor(db, actor, copy, hostel.name, hostel.fee, "");
        result.copied += 1;
      }
      await audit(db, authCtx, req, AUDIT.copy, input.toTermId, { fromTermId: input.fromTermId, ...result });
      return result;
    });
  }

  /** The child's bed this term, for the student page. */
  async studentHostel(authCtx: AuthContext, studentId: string): Promise<StudentHostelDto | null> {
    await assertUserActiveAndHasOneOf(authCtx, READ_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const term = await db.term.findFirst({ where: { schoolId: authCtx.schoolId, isCurrent: true }, select: { id: true, name: true } });
      if (!term) return null;
      const bed = await db.hostelBed.findFirst({
        where: { schoolId: authCtx.schoolId, studentId, termId: term.id },
        include: { hostel: { select: { name: true } }, room: { select: { name: true } } },
      });
      if (!bed) return null;
      return { termId: term.id, termName: term.name, hostelName: bed.hostel.name, roomName: bed.room.name, bedNumber: bed.bedNumber };
    });
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Brings the bed's charge in line with a hostel's fee: a waiting charge is
   * re-priced, or one raised if there is none; a billed one stays. A hostel
   * with no fee: a waiting charge is voided.
   */
  private async chargeFor(
    db: Db,
    actor: ChargeActor,
    bed: { id: string; studentId: string; termId: string },
    hostelName: string,
    fee: number,
    freeReason: string,
  ): Promise<"repriced" | "raised" | "voided" | "keptBilled" | "none"> {
    const source = { sourceModule: SOURCE, sourceId: bed.id };
    const description = `Hostel — ${hostelName}`;
    if (fee === 0) {
      const outcome = await this.charges.voidBySource(db, actor, { ...source, reason: freeReason || "The hostel has no fee" });
      return outcome === "billed" ? "keptBilled" : outcome === "voided" ? "voided" : "none";
    }
    const outcome = await this.charges.reprice(db, actor, { ...source, amount: fee, description });
    if (outcome === "repriced") return "repriced";
    if (outcome === "billed") return "keptBilled";
    // Removed and put back after billing: keep the billed charge, don't bill twice.
    if (await this.charges.reattachOrphan(db, actor, { studentId: bed.studentId, termId: bed.termId, kind: "HOSTEL", ...source })) {
      return "keptBilled";
    }
    await this.charges.raise(db, actor, { studentId: bed.studentId, termId: bed.termId, kind: "HOSTEL", description, amount: fee, ...source });
    return "raised";
  }
}

// ─── Withdrawal (called by StudentsService.withdraw in its own transaction) ──

/**
 * A withdrawn student's beds in terms that start after the withdrawal are
 * freed, and their waiting charges voided. This term's bed stays: the child
 * boarded, and its charge is the school's to judge.
 */
export async function removeHostelBedsAfterWithdrawal(
  db: Db,
  actor: ChargeActor,
  studentId: string,
  withdrawnAt: Date,
  charges: StudentChargeService = new StudentChargeService(),
): Promise<number> {
  const beds = await db.hostelBed.findMany({ where: { schoolId: actor.schoolId, studentId }, select: { id: true, termId: true } });
  if (beds.length === 0) return 0;
  const later = new Set(
    (await db.term.findMany({ where: { id: { in: beds.map((b) => b.termId) }, startDate: { gt: withdrawnAt } }, select: { id: true } })).map((t) => t.id),
  );
  let removed = 0;
  for (const bed of beds) {
    if (!later.has(bed.termId)) continue;
    await removeBedAndCharge(db, charges, actor, bed.id, "The student was withdrawn");
    removed += 1;
  }
  return removed;
}

async function removeBedAndCharge(db: Db, charges: StudentChargeService, actor: ChargeActor, bedId: string, reason: string) {
  await charges.voidBySource(db, actor, { sourceModule: SOURCE, sourceId: bedId, reason });
  await db.hostelBed.delete({ where: { id: bedId } });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface LockedRoom {
  id: string;
  hostel_id: string;
  beds: number;
}

/** Locks the room row for the rest of the transaction. */
async function lockRoom(db: Db, schoolId: string, id: string): Promise<LockedRoom> {
  const rows = await db.$queryRaw<LockedRoom[]>`
    SELECT id, hostel_id, beds FROM hostel_rooms WHERE id = ${id} AND school_id = ${schoolId} FOR UPDATE
  `;
  if (rows.length === 0) throw new NotFoundError("Room not found.");
  return rows[0]!;
}

/** Locks the hostel row for the rest of the transaction. */
async function lockHostel(db: Db, schoolId: string, id: string): Promise<{ name: string; fee: number; for_gender: HostelGender }> {
  const rows = await db.$queryRaw<{ name: string; fee: number; for_gender: HostelGender }[]>`
    SELECT name, fee, for_gender::text AS for_gender FROM hostels WHERE id = ${id} AND school_id = ${schoolId} FOR UPDATE
  `;
  if (rows.length === 0) throw new NotFoundError("Hostel not found.");
  return rows[0]!;
}

/** The bed asked for if it exists and is free, else the first free one. The room is locked. */
async function chooseBed(db: Db, room: LockedRoom, termId: string, wanted: number | undefined, ignoreBedId?: string): Promise<number> {
  const taken = new Set(
    (await db.hostelBed.findMany({ where: { roomId: room.id, termId, ...(ignoreBedId ? { id: { not: ignoreBedId } } : {}) }, select: { bedNumber: true } })).map(
      (b) => b.bedNumber,
    ),
  );
  if (wanted !== undefined) {
    if (wanted > room.beds) throw new ValidationError("NO_SUCH_BED", `This room has ${room.beds} beds.`);
    if (taken.has(wanted)) throw new ConflictError("BED_TAKEN", `Bed ${wanted} is taken this term.`);
    return wanted;
  }
  for (let b = 1; b <= room.beds; b += 1) if (!taken.has(b)) return b;
  throw new ConflictError("ROOM_FULL", `This room is full: all ${room.beds} beds are taken this term.`);
}

function assertGender(gender: "MALE" | "FEMALE" | "OTHER", forGender: HostelGender): void {
  if (gender === "OTHER") {
    throw new ConflictError("GENDER_NOT_SET", "Hostels are for boys or for girls. Set the student's gender on their record first.");
  }
  if ((forGender === "BOYS") !== (gender === "MALE")) {
    throw new ConflictError("WRONG_HOSTEL", forGender === "BOYS" ? "This is a boys' hostel." : "This is a girls' hostel.");
  }
}

/** Active staff holding a role that may be a house master. */
function candidateUsers(db: Db, schoolId: string) {
  return db.user.findMany({
    where: { schoolId, isActive: true, roles: { some: { role: { key: { in: [...HOUSE_MASTER_ROLE_KEYS] } } } } },
    select: { id: true, firstName: true, lastName: true, roles: { select: { role: { select: { key: true } } } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

async function readHostel(db: Db, schoolId: string, id: string, termId: string | undefined): Promise<HostelDto> {
  const row = await db.hostel.findFirst({ where: { id, schoolId }, include: HOSTEL_INCLUDE });
  if (!row) throw new NotFoundError("Hostel not found.");
  return hostelDto(row, await bedsTaken(db, schoolId, termId));
}

async function readBeds(db: Db, schoolId: string, ids: string[]): Promise<HostelBedDto[]> {
  if (ids.length === 0) return [];
  const rows = await db.hostelBed.findMany({
    where: { id: { in: ids } },
    include: {
      student: { select: { firstName: true, lastName: true, admissionNumber: true, enrollments: { select: { termId: true, classArm: { select: { name: true } } } } } },
      room: { select: { name: true } },
    },
  });
  const charges = await db.studentCharge.findMany({
    where: { schoolId, sourceModule: SOURCE, sourceId: { in: ids } },
    orderBy: { createdAt: "asc" },
    select: { sourceId: true, status: true, amount: true },
  });
  // The live charge if there is one, else the last voided one.
  const chargeByBed = new Map<string, { status: "OPEN" | "BILLED" | "VOID"; amount: number }>();
  for (const c of charges) {
    const current = chargeByBed.get(c.sourceId!);
    if (!current || current.status === "VOID") chargeByBed.set(c.sourceId!, { status: c.status, amount: c.amount });
  }
  rows.sort((a, b) => a.room.name.localeCompare(b.room.name, undefined, { numeric: true }) || a.bedNumber - b.bedNumber);
  return rows.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    studentName: `${r.student.firstName} ${r.student.lastName}`.trim(),
    admissionNumber: r.student.admissionNumber,
    classArm: r.student.enrollments.find((e) => e.termId === r.termId)?.classArm.name ?? null,
    termId: r.termId,
    hostelId: r.hostelId,
    roomId: r.roomId,
    roomName: r.room.name,
    bedNumber: r.bedNumber,
    charge: chargeByBed.get(r.id) ?? null,
  }));
}

/** Beds taken per room in a term. */
async function bedsTaken(db: Db, schoolId: string, termId: string | undefined): Promise<Map<string, number>> {
  if (!termId) return new Map();
  const counts = await db.hostelBed.groupBy({ by: ["roomId"], where: { schoolId, termId }, _count: { _all: true } });
  return new Map(counts.map((c) => [c.roomId, c._count._all]));
}

function hostelDto(row: HostelRow, taken: Map<string, number>): HostelDto {
  const rooms = [...row.rooms]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((r) => ({ id: r.id, name: r.name, beds: r.beds, taken: taken.get(r.id) ?? 0 }));
  return {
    id: row.id,
    name: row.name,
    forGender: row.forGender,
    fee: row.fee,
    houseMasters: row.houseMasters
      .map((m) => ({ id: m.user.id, name: `${m.user.firstName} ${m.user.lastName}` }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    rooms,
    beds: rooms.reduce((sum, r) => sum + r.beds, 0),
    taken: rooms.reduce((sum, r) => sum + r.taken, 0),
  };
}

/** Terms that have not ended yet: today's date against the term's end date. */
async function currentAndLaterTermIds(db: Db, schoolId: string): Promise<string[]> {
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const terms = await db.term.findMany({ where: { schoolId, endDate: { gte: today } }, select: { id: true } });
  return terms.map((t) => t.id);
}

function chargeActor(authCtx: AuthContext, req: RequestContext): ChargeActor {
  return { schoolId: authCtx.schoolId, userId: authCtx.userId, ipAddress: req.ipAddress };
}

async function uniqueOr<T>(code: string, message: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictError(code, message);
    throw e;
  }
}

async function audit(db: Db, authCtx: AuthContext, req: RequestContext, action: string, entityId: string, metadata: Record<string, string | number | null>) {
  await db.auditLog.create({
    data: { schoolId: authCtx.schoolId, userId: authCtx.userId, action, entityType: "hostel", entityId, ipAddress: req.ipAddress, metadata },
  });
}
