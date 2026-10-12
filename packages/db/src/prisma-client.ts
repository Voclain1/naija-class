import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "./generated/prisma/client.js";

// Every PrismaClient in the repo is built here (Prisma 7,
// docs/modules/prisma-7-upgrade.md). Since 7 a client needs a driver adapter,
// and the connection pool is node-postgres's, configured below, not through
// `connection_limit` / `pool_timeout` in the URL (Prisma 7 ignores those).
//
// The defaults are what production ran on Prisma 5 (D3): Prisma's own default
// pool for a 1-vCPU Fly machine (2 × CPUs + 1 = 3), a 10 s wait for a free
// connection (`pool_timeout`), idle connections closed after 300 s. pg's own
// defaults would be 10 connections and an UNBOUNDED wait, so they are never
// left to apply. withTenant's retry logic and the dashboard's pool work were
// tuned against these numbers.
export const DEFAULT_POOL_MAX = 3;
export const POOL_ACQUIRE_TIMEOUT_MS = 10_000;
export const POOL_IDLE_TIMEOUT_MS = 300_000;

/**
 * Pool size: `DATABASE_POOL_MAX` when it is a positive whole number, else 3.
 * Changing it is a capacity decision (docs/deferred.md: production's real
 * connection budget is still unverified), not part of the upgrade.
 */
export function poolMaxFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DATABASE_POOL_MAX?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_POOL_MAX;
  const n = Number(raw);
  return n >= 1 ? n : DEFAULT_POOL_MAX;
}

export interface CreatePrismaClientOptions {
  /** Pool size; defaults to poolMaxFromEnv(). */
  max?: number;
  log?: Prisma.LogDefinition[];
}

export function createPrismaClient(connectionString: string, options: CreatePrismaClientOptions = {}): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    max: options.max ?? poolMaxFromEnv(),
    connectionTimeoutMillis: POOL_ACQUIRE_TIMEOUT_MS,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
  });
  return new PrismaClient({ adapter, ...(options.log ? { log: options.log } : {}) });
}
