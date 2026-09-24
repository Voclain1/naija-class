import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { basePrisma } from "@school-kit/db";

@Controller("health")
export class HealthController {
  // Liveness only — deliberately exempt from the global Redis-backed
  // ThrottlerGuard (app.module.ts's APP_GUARD). This is Fly's health-check
  // target (apps/api/fly.toml's [[http_service.checks]] path, every 15s), and
  // every check was otherwise costing Redis commands via
  // RedisThrottlerStorage.increment: an INCR plus a TTL on every call, plus an
  // EXPIRE on the first call of each window. That is ~357k commands/month
  // spent rate-limiting Fly's own health checker — measured directly against
  // production on 2026-09-23, where three consecutive calls to this endpoint
  // returned x-ratelimit-remaining 199, 198, 197.
  //
  // Safe to exempt because this handler takes no input, touches no database,
  // requires no auth and returns a fixed shape — there is nothing here to
  // abuse by calling it repeatedly. The response is unchanged, so Fly's check
  // behaviour and the deploy smoke test are unaffected.
  //
  // Scoped to this method ONLY, not the class: checkDb() below runs a real
  // query and keeps its throttle. See its own comment.
  @SkipThrottle()
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
  //
  // Deliberately NOT @SkipThrottle()'d, unlike check() above: this handler
  // executes a real Postgres query, so it is a (small) amplification vector,
  // and it is not on Fly's check path — fly.toml points only at /health — so
  // keeping it throttled costs nothing operationally.
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
