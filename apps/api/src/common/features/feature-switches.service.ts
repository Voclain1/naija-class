import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { withTenant } from "@school-kit/db";
import {
  parseDisabledFeatures,
  parseFeatureSwitches,
  resolveFeature,
  type FeatureKey,
  type FeatureSwitchMap,
} from "@school-kit/types";

// Per-school feature switches — the resolver (2026-11-06,
// docs/modules/feature-switches.md; plan item FD-1a).
//
// The ONE place that answers "is this feature on for this school?". Callers
// never read `schools.feature_switches` themselves, so the three rules in
// @school-kit/types' feature-switches/index.ts (off by default, the platform
// wins, the key list is code) hold for every feature by construction.
//
// Reads go through withTenant rather than basePrisma: `schools` has no RLS
// policy, so the read is the same either way, and staying on the tenant path
// keeps this file off the basePrisma allowlist.
//
// CACHE. A short in-process cache (CACHE_TTL_MS) keeps a hot-path check from
// costing a transaction per request. A platform-admin write calls
// `invalidate()` in the process that served it; another API process sees the
// change within the TTL. That bound is the documented staleness of a switch
// turned OFF. The FEATURES_DISABLED variable is the immediate, all-process
// kill, read once at start (an environment change needs a restart anyway).

export const FEATURE_SWITCH_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  readonly value: FeatureSwitchMap;
  readonly expiresAt: number;
}

@Injectable()
export class FeatureSwitchesService {
  private readonly logger = new Logger(FeatureSwitchesService.name);
  private readonly disabledAll: boolean;
  private readonly disabledKeys: ReadonlySet<FeatureKey>;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    config: ConfigService,
    // Injectable clock so the TTL is testable without waiting.
    private readonly now: () => number = Date.now,
  ) {
    const parsed = parseDisabledFeatures(config.get<string>("FEATURES_DISABLED"));
    this.disabledAll = parsed.all;
    this.disabledKeys = parsed.keys;
    if (parsed.unknown.length > 0) {
      // Names only; the variable holds no secrets. Ignored, never read as "*".
      this.logger.warn(`FEATURES_DISABLED names unknown feature keys, ignored: ${parsed.unknown.join(", ")}`);
    }
  }

  /** True when the platform has switched this key off for every school. */
  isPlatformDisabled(key: FeatureKey): boolean {
    return this.disabledAll || this.disabledKeys.has(key);
  }

  /** Is `key` on for this school? Off unless the school's entry is `true` and the platform has not switched it off. */
  async isOn(schoolId: string, key: FeatureKey): Promise<boolean> {
    if (this.isPlatformDisabled(key)) return false;
    const switches = await this.schoolSwitches(schoolId);
    return resolveFeature({ platformDisabled: false, schoolValue: switches[key] });
  }

  /** The school's own switches (before the platform override), cached. An unknown school reads as all off. */
  async schoolSwitches(schoolId: string): Promise<FeatureSwitchMap> {
    const hit = this.cache.get(schoolId);
    if (hit && hit.expiresAt > this.now()) return hit.value;

    const row = await withTenant(schoolId, (db) =>
      db.school.findUnique({ where: { id: schoolId }, select: { featureSwitches: true } }),
    );
    const value = parseFeatureSwitches(row?.featureSwitches ?? null);
    this.cache.set(schoolId, { value, expiresAt: this.now() + FEATURE_SWITCH_CACHE_TTL_MS });
    return value;
  }

  /** Drops the cached entry so this process sees a write at once. */
  invalidate(schoolId: string): void {
    this.cache.delete(schoolId);
  }
}
