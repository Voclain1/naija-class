import { Injectable, Optional } from "@nestjs/common";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  LICENCE_WARNING_DAYS,
  NotFoundError,
  type CopyPlacesInput,
  type CopyPlacesResultDto,
  type CreateDriverInput,
  type CreatePlaceInput,
  type CreateRouteInput,
  type CreateVehicleInput,
  type LicenceState,
  type ListPlacesInput,
  type ListRoutesInput,
  type MovePlaceInput,
  type SetRouteFeeInput,
  type SetRouteFeeResultDto,
  type SetStopsInput,
  type StudentTransportDto,
  type TransportDriverDto,
  type TransportPlaceDto,
  type TransportRouteDto,
  type TransportVehicleDto,
  type UpdateDriverInput,
  type UpdateRouteInput,
  type UpdateVehicleInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { StudentChargeService, type ChargeActor } from "../finance/student-charge.service.js";

// Phase 9 / CP5.2 — transport (docs/modules/phase-9.md §13 CP5-D7/D8/D11).
//
// Vehicles, drivers, routes with ordered stops and a fee per term, and each
// student's place on one route and stop per term.
//
// MONEY. A place on a route that charges a fee raises one TRANSPORT student
// charge for that term, through StudentChargeService (source "transport", the
// place's id) — never a write of our own. A move keeps that one charge: still
// waiting, it takes the new route's fee; already billed, it stays as it is. A
// removal, or a move to a free route, voids a waiting charge and leaves a
// billed one for the school to refund if it chooses. Changing a route's fee
// re-prices the waiting charges of this and later terms; a past term is
// history and a billed charge never changes.
//
// CAPACITY. A route takes no more children in a term than its vehicle has
// seats, and none without a vehicle. The count is taken with the route row
// locked (SELECT … FOR UPDATE), so two staff adding the last seat at once
// cannot both succeed.

const READ_ROLES = ["owner", "admin", "bursar"] as const;
const MANAGE_ROLES = ["owner", "admin"] as const;
const FEE_ROLES = ["owner", "admin", "bursar"] as const;
const SOURCE = "transport";

const AUDIT = {
  vehicle: "transport.vehicle",
  driver: "transport.driver",
  route: "transport.route",
  stops: "transport.route.stops",
  fee: "transport.route.fee",
  place: "transport.place.create",
  move: "transport.place.move",
  remove: "transport.place.remove",
  copy: "transport.place.copy",
} as const;

type Db = PrismaClient;
interface RequestContext {
  ipAddress: string | null;
}

const ROUTE_INCLUDE = {
  vehicle: { select: { id: true, plate: true, seats: true } },
  driver: { select: { id: true, name: true, phone: true } },
  stops: { orderBy: { position: "asc" as const }, select: { id: true, name: true, position: true, pickupMinute: true } },
} satisfies Prisma.TransportRouteInclude;
type RouteRow = Prisma.TransportRouteGetPayload<{ include: typeof ROUTE_INCLUDE }>;

@Injectable()
export class TransportService {
  constructor(@Optional() private readonly charges: StudentChargeService = new StudentChargeService()) {}

  // ─── Vehicles ─────────────────────────────────────────────────────────────

  async listVehicles(authCtx: AuthContext): Promise<TransportVehicleDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, READ_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.transportVehicle.findMany({
        where: { schoolId: authCtx.schoolId },
        include: { _count: { select: { routes: true } } },
        orderBy: { plate: "asc" },
      });
      return rows.map(vehicleDto);
    });
  }

  async createVehicle(authCtx: AuthContext, input: CreateVehicleInput, req: RequestContext): Promise<TransportVehicleDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await uniqueOr("VEHICLE_EXISTS", "A vehicle with this plate number is already recorded.", () =>
        db.transportVehicle.create({
          data: { schoolId: authCtx.schoolId, plate: normalisePlate(input.plate), description: input.description ?? null, seats: input.seats },
          include: { _count: { select: { routes: true } } },
        }),
      );
      await audit(db, authCtx, req, AUDIT.vehicle, row.id, { op: "create", seats: row.seats });
      return vehicleDto(row);
    });
  }

  async updateVehicle(authCtx: AuthContext, id: string, input: UpdateVehicleInput, req: RequestContext): Promise<TransportVehicleDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.transportVehicle.findFirst({ where: { id, schoolId: authCtx.schoolId }, include: { routes: { select: { id: true } } } });
      if (!existing) throw new NotFoundError("Vehicle not found.");
      if (input.seats !== undefined && input.seats < existing.seats) {
        for (const route of existing.routes) await assertFits(db, authCtx.schoolId, route.id, input.seats);
      }
      const row = await uniqueOr("VEHICLE_EXISTS", "A vehicle with this plate number is already recorded.", () =>
        db.transportVehicle.update({
          where: { id },
          data: {
            ...(input.plate !== undefined ? { plate: normalisePlate(input.plate) } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.seats !== undefined ? { seats: input.seats } : {}),
          },
          include: { _count: { select: { routes: true } } },
        }),
      );
      await audit(db, authCtx, req, AUDIT.vehicle, id, { op: "update", seats: row.seats });
      return vehicleDto(row);
    });
  }

  async deleteVehicle(authCtx: AuthContext, id: string, req: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.transportVehicle.findFirst({ where: { id, schoolId: authCtx.schoolId }, include: { _count: { select: { routes: true } } } });
      if (!existing) throw new NotFoundError("Vehicle not found.");
      if (existing._count.routes > 0) {
        throw new ConflictError("VEHICLE_IN_USE", "This vehicle runs a route. Give the route another vehicle first.");
      }
      await db.transportVehicle.delete({ where: { id } });
      await audit(db, authCtx, req, AUDIT.vehicle, id, { op: "delete" });
    });
  }

  // ─── Drivers ──────────────────────────────────────────────────────────────

  async listDrivers(authCtx: AuthContext): Promise<TransportDriverDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, READ_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.transportDriver.findMany({
        where: { schoolId: authCtx.schoolId },
        include: { _count: { select: { routes: true } } },
        orderBy: { name: "asc" },
      });
      return rows.map(driverDto);
    });
  }

  async createDriver(authCtx: AuthContext, input: CreateDriverInput, req: RequestContext): Promise<TransportDriverDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.transportDriver.create({
        data: {
          schoolId: authCtx.schoolId,
          name: input.name,
          phone: input.phone,
          licenceNumber: input.licenceNumber ?? null,
          licenceExpiry: input.licenceExpiry ? new Date(input.licenceExpiry) : null,
        },
        include: { _count: { select: { routes: true } } },
      });
      // Ids only: a driver's name and phone are not audit metadata.
      await audit(db, authCtx, req, AUDIT.driver, row.id, { op: "create" });
      return driverDto(row);
    });
  }

  async updateDriver(authCtx: AuthContext, id: string, input: UpdateDriverInput, req: RequestContext): Promise<TransportDriverDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.transportDriver.findFirst({ where: { id, schoolId: authCtx.schoolId }, select: { id: true } });
      if (!existing) throw new NotFoundError("Driver not found.");
      const row = await db.transportDriver.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.licenceNumber !== undefined ? { licenceNumber: input.licenceNumber } : {}),
          ...(input.licenceExpiry !== undefined ? { licenceExpiry: input.licenceExpiry ? new Date(input.licenceExpiry) : null } : {}),
        },
        include: { _count: { select: { routes: true } } },
      });
      await audit(db, authCtx, req, AUDIT.driver, id, { op: "update" });
      return driverDto(row);
    });
  }

  async deleteDriver(authCtx: AuthContext, id: string, req: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.transportDriver.findFirst({ where: { id, schoolId: authCtx.schoolId }, include: { _count: { select: { routes: true } } } });
      if (!existing) throw new NotFoundError("Driver not found.");
      if (existing._count.routes > 0) {
        throw new ConflictError("DRIVER_IN_USE", "This driver drives a route. Give the route another driver first.");
      }
      await db.transportDriver.delete({ where: { id } });
      await audit(db, authCtx, req, AUDIT.driver, id, { op: "delete" });
    });
  }

  // ─── Routes ───────────────────────────────────────────────────────────────

  async listRoutes(authCtx: AuthContext, query: ListRoutesInput): Promise<TransportRouteDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, READ_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.transportRoute.findMany({ where: { schoolId: authCtx.schoolId }, include: ROUTE_INCLUDE, orderBy: { name: "asc" } });
      const taken = await placesTaken(db, authCtx.schoolId, query.termId, rows.map((r) => r.id));
      return rows.map((r) => routeDto(r, taken.get(r.id) ?? 0));
    });
  }

  async getRoute(authCtx: AuthContext, id: string, query: ListRoutesInput): Promise<TransportRouteDto> {
    await assertUserActiveAndHasOneOf(authCtx, READ_ROLES);
    return withTenant(authCtx.schoolId, (db) => this.readRoute(db, authCtx.schoolId, id, query.termId));
  }

  async createRoute(authCtx: AuthContext, input: CreateRouteInput, req: RequestContext): Promise<TransportRouteDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      await assertVehicleAndDriver(db, authCtx.schoolId, input.vehicleId, input.driverId);
      const row = await uniqueOr("ROUTE_EXISTS", "A route with this name already exists.", () =>
        db.transportRoute.create({
          data: { schoolId: authCtx.schoolId, name: input.name, vehicleId: input.vehicleId ?? null, driverId: input.driverId ?? null },
          include: ROUTE_INCLUDE,
        }),
      );
      await audit(db, authCtx, req, AUDIT.route, row.id, { op: "create" });
      return routeDto(row, 0);
    });
  }

  async updateRoute(authCtx: AuthContext, id: string, input: UpdateRouteInput, req: RequestContext): Promise<TransportRouteDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      await lockRoute(db, authCtx.schoolId, id);
      await assertVehicleAndDriver(db, authCtx.schoolId, input.vehicleId, input.driverId);
      if (input.vehicleId !== undefined) {
        const seats = input.vehicleId
          ? (await db.transportVehicle.findUniqueOrThrow({ where: { id: input.vehicleId }, select: { seats: true } })).seats
          : 0;
        await assertFits(db, authCtx.schoolId, id, seats);
      }
      await uniqueOr("ROUTE_EXISTS", "A route with this name already exists.", () =>
        db.transportRoute.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
            ...(input.driverId !== undefined ? { driverId: input.driverId } : {}),
          },
        }),
      );
      await audit(db, authCtx, req, AUDIT.route, id, { op: "update" });
      return this.readRoute(db, authCtx.schoolId, id, undefined);
    });
  }

  async deleteRoute(authCtx: AuthContext, id: string, req: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    await withTenant(authCtx.schoolId, async (db) => {
      await lockRoute(db, authCtx.schoolId, id);
      const used = await db.transportAssignment.count({ where: { routeId: id } });
      if (used > 0) {
        throw new ConflictError("ROUTE_IN_USE", "Children have places on this route. Move or remove them first.");
      }
      await db.transportRoute.delete({ where: { id } });
      await audit(db, authCtx, req, AUDIT.route, id, { op: "delete" });
    });
  }

  /** The whole ordered list: kept stops by id, new ones without. */
  async setStops(authCtx: AuthContext, id: string, input: SetStopsInput, req: RequestContext): Promise<TransportRouteDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      await lockRoute(db, authCtx.schoolId, id);
      const existing = await db.transportStop.findMany({ where: { routeId: id }, select: { id: true } });
      const existingIds = new Set(existing.map((s) => s.id));
      const keptIds = new Set(input.stops.flatMap((s) => (s.id ? [s.id] : [])));
      for (const keptId of keptIds) {
        if (!existingIds.has(keptId)) throw new NotFoundError("A stop in the list is not on this route.");
      }
      const dropped = [...existingIds].filter((s) => !keptIds.has(s));
      if (dropped.length > 0) {
        const inUse = await db.transportAssignment.count({ where: { stopId: { in: dropped } } });
        if (inUse > 0) {
          throw new ConflictError("STOP_IN_USE", "Children are picked up at a stop you removed. Move them to another stop first.");
        }
        await db.transportStop.deleteMany({ where: { id: { in: dropped } } });
      }
      for (const [position, stop] of input.stops.entries()) {
        const data = { name: stop.name, position, pickupMinute: stop.pickupMinute ?? null };
        if (stop.id) await db.transportStop.update({ where: { id: stop.id }, data });
        else await db.transportStop.create({ data: { ...data, schoolId: authCtx.schoolId, routeId: id } });
      }
      await audit(db, authCtx, req, AUDIT.stops, id, { stops: input.stops.length, removed: dropped.length });
      return this.readRoute(db, authCtx.schoolId, id, undefined);
    });
  }

  /**
   * The route's fee, set on the route's own page (owner, 2026-10-14). Waiting
   * charges for this and later terms take the new fee; billed ones keep theirs.
   */
  async setFee(authCtx: AuthContext, id: string, input: SetRouteFeeInput, req: RequestContext): Promise<SetRouteFeeResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, FEE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const route = await lockRoute(db, authCtx.schoolId, id);
      await db.transportRoute.update({ where: { id }, data: { fee: input.fee } });
      const places = await db.transportAssignment.findMany({
        where: { routeId: id, termId: { in: await currentAndLaterTermIds(db, authCtx.schoolId) } },
        select: { id: true, studentId: true, termId: true },
      });
      const actor = chargeActor(authCtx, req);
      const result = { repriced: 0, raised: 0, voided: 0, keptBilled: 0 };
      for (const place of places) {
        const outcome = await this.chargeFor(db, actor, place, route.name, input.fee, "The route became free");
        if (outcome !== "none") result[outcome] += 1;
      }
      await audit(db, authCtx, req, AUDIT.fee, id, { from: route.fee, to: input.fee, ...result });
      return { route: await this.readRoute(db, authCtx.schoolId, id, undefined), ...result };
    });
  }

  // ─── Places ───────────────────────────────────────────────────────────────

  async listPlaces(authCtx: AuthContext, routeId: string, query: ListPlacesInput): Promise<TransportPlaceDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, READ_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const route = await db.transportRoute.findFirst({ where: { id: routeId, schoolId: authCtx.schoolId }, select: { id: true } });
      if (!route) throw new NotFoundError("Route not found.");
      const rows = await db.transportAssignment.findMany({
        where: { routeId, termId: query.termId },
        select: { id: true },
      });
      return this.readPlaces(db, authCtx.schoolId, rows.map((r) => r.id));
    });
  }

  async createPlace(authCtx: AuthContext, input: CreatePlaceInput, req: RequestContext): Promise<TransportPlaceDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const [student, term] = await Promise.all([
        db.student.findFirst({ where: { id: input.studentId, schoolId: authCtx.schoolId }, select: { status: true } }),
        db.term.findFirst({ where: { id: input.termId, schoolId: authCtx.schoolId }, select: { id: true } }),
      ]);
      if (!student) throw new NotFoundError("Student not found.");
      if (!term) throw new NotFoundError("Term not found.");
      if (student.status === "WITHDRAWN" || student.status === "GRADUATED") {
        throw new ConflictError("STUDENT_LEFT", "This student has left the school.");
      }
      const route = await lockRoute(db, authCtx.schoolId, input.routeId);
      await assertStopOnRoute(db, input.stopId, input.routeId);
      await assertSeat(db, authCtx.schoolId, input.routeId, input.termId);
      const place = await uniqueOr("ALREADY_PLACED", "This student already has a place on a route this term.", () =>
        db.transportAssignment.create({
          data: {
            schoolId: authCtx.schoolId,
            studentId: input.studentId,
            termId: input.termId,
            routeId: input.routeId,
            stopId: input.stopId,
            createdBy: authCtx.userId,
          },
        }),
      );
      await this.chargeFor(db, chargeActor(authCtx, req), place, route.name, route.fee, "");
      await audit(db, authCtx, req, AUDIT.place, place.id, { studentId: input.studentId, termId: input.termId, routeId: input.routeId });
      return (await this.readPlaces(db, authCtx.schoolId, [place.id]))[0]!;
    });
  }

  async movePlace(authCtx: AuthContext, id: string, input: MovePlaceInput, req: RequestContext): Promise<TransportPlaceDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const place = await db.transportAssignment.findFirst({ where: { id, schoolId: authCtx.schoolId } });
      if (!place) throw new NotFoundError("Place not found.");
      const sameRoute = place.routeId === input.routeId;
      // Lock both routes in id order, so two crossing moves cannot deadlock.
      const ids = [...new Set([place.routeId, input.routeId])].sort();
      const locked = new Map<string, { name: string; fee: number }>();
      for (const routeId of ids) locked.set(routeId, await lockRoute(db, authCtx.schoolId, routeId));
      await assertStopOnRoute(db, input.stopId, input.routeId);
      if (!sameRoute) await assertSeat(db, authCtx.schoolId, input.routeId, place.termId);
      await db.transportAssignment.update({ where: { id }, data: { routeId: input.routeId, stopId: input.stopId } });
      if (!sameRoute) {
        const target = locked.get(input.routeId)!;
        await this.chargeFor(db, chargeActor(authCtx, req), place, target.name, target.fee, "Moved to a free route");
      }
      await audit(db, authCtx, req, AUDIT.move, id, { fromRouteId: place.routeId, toRouteId: input.routeId });
      return (await this.readPlaces(db, authCtx.schoolId, [id]))[0]!;
    });
  }

  async removePlace(authCtx: AuthContext, id: string, req: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    await withTenant(authCtx.schoolId, async (db) => {
      const place = await db.transportAssignment.findFirst({ where: { id, schoolId: authCtx.schoolId } });
      if (!place) throw new NotFoundError("Place not found.");
      await removePlaceAndCharge(db, this.charges, chargeActor(authCtx, req), place.id, "Removed from the route");
      await audit(db, authCtx, req, AUDIT.remove, id, { studentId: place.studentId, termId: place.termId, routeId: place.routeId });
    });
  }

  /**
   * Next term: the same children on the same stops, within each route's
   * seats, raising next term's charges (which wait for next term's invoices).
   */
  async copyPlaces(authCtx: AuthContext, input: CopyPlacesInput, req: RequestContext): Promise<CopyPlacesResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const terms = await db.term.count({ where: { schoolId: authCtx.schoolId, id: { in: [input.fromTermId, input.toTermId] } } });
      if (terms !== 2) throw new NotFoundError("Term not found.");
      const from = await db.transportAssignment.findMany({
        where: { schoolId: authCtx.schoolId, termId: input.fromTermId },
        include: { student: { select: { status: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const routes = new Map<string, { name: string; fee: number }>();
      for (const routeId of [...new Set(from.map((p) => p.routeId))].sort()) {
        routes.set(routeId, await lockRoute(db, authCtx.schoolId, routeId));
      }
      const already = new Set(
        (await db.transportAssignment.findMany({ where: { termId: input.toTermId }, select: { studentId: true } })).map((p) => p.studentId),
      );
      const result: CopyPlacesResultDto = { copied: 0, alreadyPlaced: 0, routeFull: 0, leftSchool: 0 };
      const actor = chargeActor(authCtx, req);
      for (const p of from) {
        if (p.student.status === "WITHDRAWN" || p.student.status === "GRADUATED") {
          result.leftSchool += 1;
          continue;
        }
        if (already.has(p.studentId)) {
          result.alreadyPlaced += 1;
          continue;
        }
        if (!(await hasSeat(db, authCtx.schoolId, p.routeId, input.toTermId))) {
          result.routeFull += 1;
          continue;
        }
        const copy = await db.transportAssignment.create({
          data: { schoolId: authCtx.schoolId, studentId: p.studentId, termId: input.toTermId, routeId: p.routeId, stopId: p.stopId, createdBy: authCtx.userId },
        });
        const route = routes.get(p.routeId)!;
        await this.chargeFor(db, actor, copy, route.name, route.fee, "");
        result.copied += 1;
      }
      await audit(db, authCtx, req, AUDIT.copy, input.toTermId, { fromTermId: input.fromTermId, ...result });
      return result;
    });
  }

  /** The child's route and stop this term, for the student page. */
  async studentTransport(authCtx: AuthContext, studentId: string): Promise<StudentTransportDto | null> {
    await assertUserActiveAndHasOneOf(authCtx, READ_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const term = await db.term.findFirst({ where: { schoolId: authCtx.schoolId, isCurrent: true }, select: { id: true, name: true } });
      if (!term) return null;
      const place = await db.transportAssignment.findFirst({
        where: { schoolId: authCtx.schoolId, studentId, termId: term.id },
        include: { route: { select: { name: true } }, stop: { select: { name: true, pickupMinute: true } } },
      });
      if (!place) return null;
      return { termId: term.id, termName: term.name, routeName: place.route.name, stopName: place.stop.name, pickupMinute: place.stop.pickupMinute };
    });
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Brings the place's charge in line with a route's fee. A paid route: the
   * waiting charge is re-priced, or one is raised if there is none; a billed
   * one stays. A free route: a waiting charge is voided.
   */
  private async chargeFor(
    db: Db,
    actor: ChargeActor,
    place: { id: string; studentId: string; termId: string },
    routeName: string,
    fee: number,
    freeReason: string,
  ): Promise<"repriced" | "raised" | "voided" | "keptBilled" | "none"> {
    const source = { sourceModule: SOURCE, sourceId: place.id };
    const description = `Transport — ${routeName}`;
    if (fee === 0) {
      const outcome = await this.charges.voidBySource(db, actor, { ...source, reason: freeReason || "The route is free" });
      return outcome === "billed" ? "keptBilled" : outcome === "voided" ? "voided" : "none";
    }
    const outcome = await this.charges.reprice(db, actor, { ...source, amount: fee, description });
    if (outcome === "repriced") return "repriced";
    if (outcome === "billed") return "keptBilled";
    await this.charges.raise(db, actor, { studentId: place.studentId, termId: place.termId, kind: "TRANSPORT", description, amount: fee, ...source });
    return "raised";
  }

  private async readRoute(db: Db, schoolId: string, id: string, termId: string | undefined): Promise<TransportRouteDto> {
    const row = await db.transportRoute.findFirst({ where: { id, schoolId }, include: ROUTE_INCLUDE });
    if (!row) throw new NotFoundError("Route not found.");
    const taken = await placesTaken(db, schoolId, termId, [id]);
    return routeDto(row, taken.get(id) ?? 0);
  }

  private async readPlaces(db: Db, schoolId: string, ids: string[]): Promise<TransportPlaceDto[]> {
    if (ids.length === 0) return [];
    const rows = await db.transportAssignment.findMany({
      where: { id: { in: ids } },
      include: {
        student: {
          select: { firstName: true, lastName: true, admissionNumber: true, enrollments: { select: { termId: true, classArm: { select: { name: true } } } } },
        },
        stop: { select: { name: true, position: true } },
      },
    });
    const charges = await db.studentCharge.findMany({
      where: { schoolId, sourceModule: SOURCE, sourceId: { in: ids } },
      orderBy: { createdAt: "asc" },
      select: { sourceId: true, status: true, amount: true },
    });
    // The live charge if there is one, else the last voided one.
    const chargeBySource = new Map<string, { status: "OPEN" | "BILLED" | "VOID"; amount: number }>();
    for (const c of charges) {
      const current = chargeBySource.get(c.sourceId!);
      if (!current || current.status === "VOID") chargeBySource.set(c.sourceId!, { status: c.status, amount: c.amount });
    }
    rows.sort(
      (a, b) =>
        a.stop.position - b.stop.position ||
        a.student.lastName.localeCompare(b.student.lastName) ||
        a.student.firstName.localeCompare(b.student.firstName),
    );
    return rows.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      studentName: `${r.student.firstName} ${r.student.lastName}`.trim(),
      admissionNumber: r.student.admissionNumber,
      classArm: r.student.enrollments.find((e) => e.termId === r.termId)?.classArm.name ?? null,
      termId: r.termId,
      routeId: r.routeId,
      stopId: r.stopId,
      stopName: r.stop.name,
      charge: chargeBySource.get(r.id) ?? null,
    }));
  }
}

// ─── Withdrawal (called by StudentsService.withdraw in its own transaction) ──

/**
 * A withdrawn student's places in terms that start after the withdrawal are
 * removed, and their waiting charges voided (CP5-D8). The current term's place
 * stays: the child may have ridden, and its charge is the school's to judge.
 */
export async function removeTransportAfterWithdrawal(
  db: Db,
  actor: ChargeActor,
  studentId: string,
  withdrawnAt: Date,
  charges: StudentChargeService = new StudentChargeService(),
): Promise<number> {
  const later = await db.transportAssignment.findMany({
    where: { schoolId: actor.schoolId, studentId },
    select: { id: true, termId: true },
  });
  if (later.length === 0) return 0;
  const terms = await db.term.findMany({
    where: { id: { in: later.map((p) => p.termId) }, startDate: { gt: withdrawnAt } },
    select: { id: true },
  });
  const laterTermIds = new Set(terms.map((t) => t.id));
  let removed = 0;
  for (const place of later) {
    if (!laterTermIds.has(place.termId)) continue;
    await removePlaceAndCharge(db, charges, actor, place.id, "The student was withdrawn");
    removed += 1;
  }
  return removed;
}

async function removePlaceAndCharge(db: Db, charges: StudentChargeService, actor: ChargeActor, placeId: string, reason: string) {
  await charges.voidBySource(db, actor, { sourceModule: SOURCE, sourceId: placeId, reason });
  await db.transportAssignment.delete({ where: { id: placeId } });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** "  kja 123  xy " → "KJA 123 XY", as the request schema does; plates are unique per school. */
function normalisePlate(plate: string): string {
  return plate.trim().toUpperCase().replace(/\s+/g, " ");
}

function chargeActor(authCtx: AuthContext, req: RequestContext): ChargeActor {
  return { schoolId: authCtx.schoolId, userId: authCtx.userId, ipAddress: req.ipAddress };
}

/** Locks the route row for the rest of the transaction and returns it. */
async function lockRoute(db: Db, schoolId: string, id: string): Promise<{ name: string; fee: number }> {
  const rows = await db.$queryRaw<{ name: string; fee: number }[]>`
    SELECT name, fee FROM transport_routes WHERE id = ${id} AND school_id = ${schoolId} FOR UPDATE
  `;
  if (rows.length === 0) throw new NotFoundError("Route not found.");
  return rows[0]!;
}

async function routeSeats(db: Db, routeId: string): Promise<number> {
  const route = await db.transportRoute.findUniqueOrThrow({ where: { id: routeId }, select: { vehicle: { select: { seats: true } } } });
  return route.vehicle?.seats ?? 0;
}

async function hasSeat(db: Db, schoolId: string, routeId: string, termId: string): Promise<boolean> {
  const [seats, taken] = await Promise.all([
    routeSeats(db, routeId),
    db.transportAssignment.count({ where: { schoolId, routeId, termId } }),
  ]);
  return taken < seats;
}

async function assertSeat(db: Db, schoolId: string, routeId: string, termId: string) {
  if (!(await hasSeat(db, schoolId, routeId, termId))) {
    const seats = await routeSeats(db, routeId);
    throw new ConflictError(
      "ROUTE_FULL",
      seats === 0 ? "This route has no vehicle yet, so it cannot take children." : `This route is full: its vehicle has ${seats} seats.`,
    );
  }
}

/** A vehicle of `seats` must hold every term's children, this term and later. */
async function assertFits(db: Db, schoolId: string, routeId: string, seats: number) {
  const termIds = await currentAndLaterTermIds(db, schoolId);
  const counts = await db.transportAssignment.groupBy({
    by: ["termId"],
    where: { schoolId, routeId, termId: { in: termIds } },
    _count: { _all: true },
  });
  const most = Math.max(0, ...counts.map((c) => c._count._all));
  if (most > seats) {
    throw new ConflictError("VEHICLE_TOO_SMALL", `This route has ${most} children in a term; the vehicle must seat at least that many.`);
  }
}

async function assertStopOnRoute(db: Db, stopId: string, routeId: string) {
  const stop = await db.transportStop.findFirst({ where: { id: stopId, routeId }, select: { id: true } });
  if (!stop) throw new NotFoundError("That stop is not on this route.");
}

async function assertVehicleAndDriver(db: Db, schoolId: string, vehicleId?: string | null, driverId?: string | null) {
  if (vehicleId && !(await db.transportVehicle.findFirst({ where: { id: vehicleId, schoolId }, select: { id: true } }))) {
    throw new NotFoundError("Vehicle not found.");
  }
  if (driverId && !(await db.transportDriver.findFirst({ where: { id: driverId, schoolId }, select: { id: true } }))) {
    throw new NotFoundError("Driver not found.");
  }
}

/** Terms that have not ended yet: today's date against the term's end date. */
async function currentAndLaterTermIds(db: Db, schoolId: string): Promise<string[]> {
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const terms = await db.term.findMany({ where: { schoolId, endDate: { gte: today } }, select: { id: true } });
  return terms.map((t) => t.id);
}

async function placesTaken(db: Db, schoolId: string, termId: string | undefined, routeIds: string[]): Promise<Map<string, number>> {
  if (!termId || routeIds.length === 0) return new Map();
  const counts = await db.transportAssignment.groupBy({
    by: ["routeId"],
    where: { schoolId, termId, routeId: { in: routeIds } },
    _count: { _all: true },
  });
  return new Map(counts.map((c) => [c.routeId, c._count._all]));
}

async function uniqueOr<T>(code: string, message: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictError(code, message);
    throw e;
  }
}

async function audit(
  db: Db,
  authCtx: AuthContext,
  req: RequestContext,
  action: string,
  entityId: string,
  metadata: Record<string, string | number | null>,
) {
  await db.auditLog.create({
    data: { schoolId: authCtx.schoolId, userId: authCtx.userId, action, entityType: "transport", entityId, ipAddress: req.ipAddress, metadata },
  });
}

function vehicleDto(row: { id: string; plate: string; description: string | null; seats: number; _count: { routes: number } }): TransportVehicleDto {
  return { id: row.id, plate: row.plate, description: row.description, seats: row.seats, routeCount: row._count.routes };
}

export function licenceState(expiry: Date | null, now = new Date()): LicenceState {
  if (!expiry) return "NOT_RECORDED";
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`).getTime();
  const days = Math.round((expiry.getTime() - today) / 86_400_000);
  if (days < 0) return "EXPIRED";
  return days <= LICENCE_WARNING_DAYS ? "EXPIRING" : "VALID";
}

function driverDto(row: {
  id: string;
  name: string;
  phone: string;
  licenceNumber: string | null;
  licenceExpiry: Date | null;
  _count: { routes: number };
}): TransportDriverDto {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    licenceNumber: row.licenceNumber,
    licenceExpiry: row.licenceExpiry ? row.licenceExpiry.toISOString().slice(0, 10) : null,
    licenceState: licenceState(row.licenceExpiry),
    routeCount: row._count.routes,
  };
}

function routeDto(row: RouteRow, placesTakenCount: number): TransportRouteDto {
  return {
    id: row.id,
    name: row.name,
    fee: row.fee,
    vehicle: row.vehicle,
    driver: row.driver,
    stops: row.stops,
    placesTaken: placesTakenCount,
    seats: row.vehicle?.seats ?? 0,
  };
}
