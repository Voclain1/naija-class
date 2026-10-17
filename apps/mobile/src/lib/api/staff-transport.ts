import type { DailyRouteListDto, TransportRouteDto } from "@school-kit/types";

import { apiFetch } from "./client";

// Phase 9 / CP5.3 — bus routes and a route's list for one day
// (docs/modules/phase-9.md §13 CP5-D9). transport.read: owner, admin, bursar.

export function staffTransportRoutes(): Promise<TransportRouteDto[]> {
  return apiFetch<TransportRouteDto[]>("/transport/routes");
}

export function staffTransportDaily(routeId: string, date: string): Promise<DailyRouteListDto> {
  return apiFetch<DailyRouteListDto>(
    `/transport/routes/${encodeURIComponent(routeId)}/daily?${new URLSearchParams({ date }).toString()}`,
  );
}
