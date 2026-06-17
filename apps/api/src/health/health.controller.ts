import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { basePrisma } from "@school-kit/db";

@Controller("health")
export class HealthController {
  @Get()
  check() {
    return {
      status: "ok",
      service: "school-kit-api",
      timestamp: new Date().toISOString(),
    };
  }

  // Smoke-test step 2: confirms the DB is reachable AND the runtime role is
  // app_user (not school_kit). A misconfigured DATABASE_URL that points at the
  // migration role would silently bypass RLS for every tenant query — catching
  // it here surfaces it before any real traffic hits.
  @Get("db")
  async checkDb() {
    const rows = await basePrisma.$queryRawUnsafe<Array<{ role: string }>>(
      "SELECT current_user AS role",
    );
    const role = rows[0]?.role ?? "unknown";
    if (role !== "app_user") {
      throw new HttpException(
        { status: "error", role, expected: "app_user" },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: "ok", role };
  }
}
