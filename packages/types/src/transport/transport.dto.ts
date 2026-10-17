import { z } from "zod";

// ---------------------------------------------------------------------------
// Phase 9 / CP5.2 — Transport (docs/modules/phase-9.md §13 CP5-D7/D8).
//
// Vehicles, drivers, routes with ordered stops and a fee per term, and each
// student's place on one route and stop per term. A place raises a transport
// student charge at the route's fee; nobody types an amount per student.
// Money is kobo. Pickup times are minutes since midnight (formatMinuteOfDay).
// ---------------------------------------------------------------------------

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

/** ₦10,000,000 in kobo — the student-charge ceiling. */
export const MAX_ROUTE_FEE_KOBO = 1_000_000_000;
export const MAX_ROUTE_STOPS = 40;
/** The driver list warns this many days before a licence expires. */
export const LICENCE_WARNING_DAYS = 30;

// ─── Vehicles ──────────────────────────────────────────────────────────────

export interface TransportVehicleDto {
  id: string;
  plate: string;
  description: string | null;
  seats: number;
  /** How many routes use it. */
  routeCount: number;
}

export const createVehicleSchema = z.object({
  plate: z.string().trim().min(1).max(20).transform((v) => v.toUpperCase().replace(/\s+/g, " ")),
  description: optionalText(120),
  seats: z.number().int().min(1).max(200),
});
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export const updateVehicleSchema = createVehicleSchema.partial();
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

// ─── Drivers ───────────────────────────────────────────────────────────────

/** Worked out by the server against today's date. */
export type LicenceState = "VALID" | "EXPIRING" | "EXPIRED" | "NOT_RECORDED";

export interface TransportDriverDto {
  id: string;
  name: string;
  phone: string;
  licenceNumber: string | null;
  licenceExpiry: string | null; // YYYY-MM-DD
  licenceState: LicenceState;
  routeCount: number;
}

export const createDriverSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(7).max(20),
  licenceNumber: optionalText(40),
  licenceExpiry: date.nullable().optional(),
});
export type CreateDriverInput = z.infer<typeof createDriverSchema>;
export const updateDriverSchema = createDriverSchema.partial();
export type UpdateDriverInput = z.infer<typeof updateDriverSchema>;

// ─── Routes and stops ──────────────────────────────────────────────────────

export interface TransportStopDto {
  id: string;
  name: string;
  position: number;
  pickupMinute: number | null;
}

export interface TransportRouteDto {
  id: string;
  name: string;
  fee: number; // kobo per term; 0 is free
  vehicle: { id: string; plate: string; seats: number } | null;
  driver: { id: string; name: string; phone: string } | null;
  stops: TransportStopDto[];
  /** Places taken in the term asked for (0 when no term was given). */
  placesTaken: number;
  /** The vehicle's seats, or 0 with no vehicle: the route then takes nobody. */
  seats: number;
}

export const listRoutesSchema = z.object({ termId: z.string().uuid().optional() });
export type ListRoutesInput = z.infer<typeof listRoutesSchema>;

export const createRouteSchema = z.object({
  name: z.string().trim().min(1).max(80),
  vehicleId: z.string().uuid().nullable().optional(),
  driverId: z.string().uuid().nullable().optional(),
});
export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export const updateRouteSchema = createRouteSchema.partial();
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;

/** The fee is set on the route's own page (owner, 2026-10-14). */
export const setRouteFeeSchema = z.object({
  fee: z.number().int().min(0).max(MAX_ROUTE_FEE_KOBO),
});
export type SetRouteFeeInput = z.infer<typeof setRouteFeeSchema>;

export interface SetRouteFeeResultDto {
  route: TransportRouteDto;
  /** Waiting charges given the new fee. */
  repriced: number;
  /** Charges raised because the route stopped being free. */
  raised: number;
  /** Waiting charges voided because the route became free. */
  voided: number;
  /** Charges already on an invoice, which keep their amount. */
  keptBilled: number;
}

/** The whole ordered list; a stop with an id is kept, one without is new. */
export const setStopsSchema = z.object({
  stops: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(80),
        pickupMinute: z.number().int().min(0).max(1439).nullable().optional(),
      }),
    )
    .max(MAX_ROUTE_STOPS),
});
export type SetStopsInput = z.infer<typeof setStopsSchema>;

// ─── Places on a route ─────────────────────────────────────────────────────

export interface TransportPlaceDto {
  id: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  classArm: string | null;
  termId: string;
  routeId: string;
  stopId: string;
  stopName: string;
  /** The transport charge for this place, if the route charges a fee. */
  charge: { status: "OPEN" | "BILLED" | "VOID"; amount: number } | null;
}

export const listPlacesSchema = z.object({ termId: z.string().uuid() });
export type ListPlacesInput = z.infer<typeof listPlacesSchema>;

export const createPlaceSchema = z.object({
  studentId: z.string().uuid(),
  termId: z.string().uuid(),
  routeId: z.string().uuid(),
  stopId: z.string().uuid(),
});
export type CreatePlaceInput = z.infer<typeof createPlaceSchema>;

export const movePlaceSchema = z.object({
  routeId: z.string().uuid(),
  stopId: z.string().uuid(),
});
export type MovePlaceInput = z.infer<typeof movePlaceSchema>;

export const copyPlacesSchema = z
  .object({
    fromTermId: z.string().uuid(),
    toTermId: z.string().uuid(),
  })
  .refine((v) => v.fromTermId !== v.toTermId, { message: "Choose two different terms", path: ["toTermId"] });
export type CopyPlacesInput = z.infer<typeof copyPlacesSchema>;

export interface CopyPlacesResultDto {
  copied: number;
  /** Already on a route in the new term. */
  alreadyPlaced: number;
  /** Left out because the route was full. */
  routeFull: number;
  /** Withdrawn or graduated since. */
  leftSchool: number;
}

/** A child's route this term, for the student page. */
export interface StudentTransportDto {
  termId: string;
  termName: string;
  routeName: string;
  stopName: string;
  pickupMinute: number | null;
}

// ─── The daily route list (CP5.3, CP5-D9) ──────────────────────────────────

export const dailyRouteListSchema = z.object({ date });
export type DailyRouteListInput = z.infer<typeof dailyRouteListSchema>;

/**
 * The route for one day, stop by stop, for the driver. Carries the primary
 * guardian's phone (owner, 2026-10-16) so a driver waiting at a stop can
 * call; the printed copy is marked confidential. Only children enrolled in
 * the term that day covers, and still at the school.
 */
export interface DailyRouteListDto {
  date: string; // YYYY-MM-DD
  termId: string | null;
  termName: string | null;
  route: {
    id: string;
    name: string;
    vehiclePlate: string | null;
    driverName: string | null;
    driverPhone: string | null;
  };
  stops: Array<{
    id: string;
    name: string;
    pickupMinute: number | null;
    children: Array<{
      studentId: string;
      name: string;
      admissionNumber: string;
      classArm: string | null;
      guardianPhone: string | null;
    }>;
  }>;
  total: number;
}

// ─── What a parent sees (CP5.3, CP5-D10) ───────────────────────────────────

/** A child's route this term, for their parent: route, stop, driver and bus. */
export interface PortalStudentTransportDto {
  termName: string;
  routeName: string;
  stopName: string;
  pickupMinute: number | null;
  driverName: string | null;
  driverPhone: string | null;
  vehiclePlate: string | null;
}
