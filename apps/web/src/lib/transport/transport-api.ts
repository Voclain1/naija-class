import type {
  CopyPlacesInput,
  CopyPlacesResultDto,
  CreateDriverInput,
  CreatePlaceInput,
  CreateRouteInput,
  CreateVehicleInput,
  DailyRouteListDto,
  MovePlaceInput,
  SetRouteFeeResultDto,
  SetStopsInput,
  StudentTransportDto,
  TransportDriverDto,
  TransportPlaceDto,
  TransportRouteDto,
  TransportVehicleDto,
  UpdateDriverInput,
  UpdateRouteInput,
  UpdateVehicleInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// Phase 9 / CP5.2 — transport (docs/modules/phase-9.md §13).

const id = (value: string) => encodeURIComponent(value);
const termQuery = (termId?: string) => (termId ? `?${new URLSearchParams({ termId })}` : "");

export const listVehicles = () => apiFetch<TransportVehicleDto[]>("/transport/vehicles", { method: "GET" });
export const createVehicle = (body: CreateVehicleInput) =>
  apiFetch<TransportVehicleDto>("/transport/vehicles", { method: "POST", body });
export const updateVehicle = (vehicleId: string, body: UpdateVehicleInput) =>
  apiFetch<TransportVehicleDto>(`/transport/vehicles/${id(vehicleId)}`, { method: "PATCH", body });
export const deleteVehicle = (vehicleId: string) =>
  apiFetch<void>(`/transport/vehicles/${id(vehicleId)}`, { method: "DELETE" });

export const listDrivers = () => apiFetch<TransportDriverDto[]>("/transport/drivers", { method: "GET" });
export const createDriver = (body: CreateDriverInput) =>
  apiFetch<TransportDriverDto>("/transport/drivers", { method: "POST", body });
export const updateDriver = (driverId: string, body: UpdateDriverInput) =>
  apiFetch<TransportDriverDto>(`/transport/drivers/${id(driverId)}`, { method: "PATCH", body });
export const deleteDriver = (driverId: string) =>
  apiFetch<void>(`/transport/drivers/${id(driverId)}`, { method: "DELETE" });

export const listRoutes = (termId?: string) =>
  apiFetch<TransportRouteDto[]>(`/transport/routes${termQuery(termId)}`, { method: "GET" });
export const getRoute = (routeId: string, termId?: string) =>
  apiFetch<TransportRouteDto>(`/transport/routes/${id(routeId)}${termQuery(termId)}`, { method: "GET" });
export const createRoute = (body: CreateRouteInput) =>
  apiFetch<TransportRouteDto>("/transport/routes", { method: "POST", body });
export const updateRoute = (routeId: string, body: UpdateRouteInput) =>
  apiFetch<TransportRouteDto>(`/transport/routes/${id(routeId)}`, { method: "PATCH", body });
export const deleteRoute = (routeId: string) =>
  apiFetch<void>(`/transport/routes/${id(routeId)}`, { method: "DELETE" });
export const setStops = (routeId: string, body: SetStopsInput) =>
  apiFetch<TransportRouteDto>(`/transport/routes/${id(routeId)}/stops`, { method: "PUT", body });
export const setRouteFee = (routeId: string, fee: number) =>
  apiFetch<SetRouteFeeResultDto>(`/transport/routes/${id(routeId)}/fee`, { method: "PUT", body: { fee } });

export const listPlaces = (routeId: string, termId: string) =>
  apiFetch<TransportPlaceDto[]>(`/transport/routes/${id(routeId)}/places${termQuery(termId)}`, { method: "GET" });
export const createPlace = (body: CreatePlaceInput) =>
  apiFetch<TransportPlaceDto>("/transport/places", { method: "POST", body });
export const movePlace = (placeId: string, body: MovePlaceInput) =>
  apiFetch<TransportPlaceDto>(`/transport/places/${id(placeId)}`, { method: "PATCH", body });
export const removePlace = (placeId: string) =>
  apiFetch<void>(`/transport/places/${id(placeId)}`, { method: "DELETE" });
export const copyPlaces = (body: CopyPlacesInput) =>
  apiFetch<CopyPlacesResultDto>("/transport/places/copy", { method: "POST", body });

export const getStudentTransport = (studentId: string) =>
  apiFetch<StudentTransportDto | null>(`/transport/students/${id(studentId)}`, { method: "GET" });

// Phase 9 / CP5.3 — the day's list for the driver.
export const getDailyList = (routeId: string, date: string) =>
  apiFetch<DailyRouteListDto>(
    `/transport/routes/${id(routeId)}/daily?${new URLSearchParams({ date })}`,
    { method: "GET" },
  );
