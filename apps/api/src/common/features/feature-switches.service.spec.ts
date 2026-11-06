import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConfigService } from "@nestjs/config";

import { basePrisma } from "@school-kit/db";
import {
  FEATURE_KEYS,
  parseDisabledFeatures,
  parseFeatureSwitches,
  platformAdminSetFeatureSchema,
  resolveFeature,
} from "@school-kit/types";

import { FEATURE_SWITCH_CACHE_TTL_MS, FeatureSwitchesService } from "./feature-switches.service";

// Per-school feature switches (2026-11-06, docs/modules/feature-switches.md).
// The rules are pure and in @school-kit/types; the resolver runs against a
// real database, which is what proves a school's stored value is read, cached
// and overridden as documented.

const config = (env: Record<string, string | undefined>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

describe("feature switch rules", () => {
  it("is off by default: no entry, a non-true value, or a malformed value all read as off", () => {
    for (const raw of [undefined, null, {}, [], "on", 1, { "assistant-help": "true" }, { "assistant-help": 1 }]) {
      expect(parseFeatureSwitches(raw)["assistant-help"]).toBe(false);
    }
    expect(parseFeatureSwitches({ "assistant-help": true })["assistant-help"]).toBe(true);
  });

  it("ignores keys this build does not know, on read", () => {
    const parsed = parseFeatureSwitches({ "assistant-help": false, "not-a-feature": true });
    expect(Object.keys(parsed).sort()).toEqual([...FEATURE_KEYS].sort());
  });

  it("the platform's off beats the school's on — the full precedence matrix", () => {
    expect(resolveFeature({ platformDisabled: false, schoolValue: false })).toBe(false);
    expect(resolveFeature({ platformDisabled: false, schoolValue: true })).toBe(true);
    expect(resolveFeature({ platformDisabled: true, schoolValue: false })).toBe(false);
    expect(resolveFeature({ platformDisabled: true, schoolValue: true })).toBe(false);
  });

  it("reads FEATURES_DISABLED as a key list or '*', and never reads an unknown name as '*'", () => {
    expect(parseDisabledFeatures(undefined)).toMatchObject({ all: false, unknown: [] });
    expect(parseDisabledFeatures("*").all).toBe(true);
    const listed = parseDisabledFeatures(" assistant-help , typo-key ");
    expect(listed.all).toBe(false);
    expect([...listed.keys]).toEqual(["assistant-help"]);
    expect(listed.unknown).toEqual(["typo-key"]);
  });

  it("rejects an unknown key, a non-boolean and an extra field on write", () => {
    expect(platformAdminSetFeatureSchema.safeParse({ key: "assistant-help", enabled: true }).success).toBe(true);
    expect(platformAdminSetFeatureSchema.safeParse({ key: "not-a-feature", enabled: true }).success).toBe(false);
    expect(platformAdminSetFeatureSchema.safeParse({ key: "assistant-help", enabled: "true" }).success).toBe(false);
    expect(
      platformAdminSetFeatureSchema.safeParse({ key: "assistant-help", enabled: true, schoolId: "x" }).success,
    ).toBe(false);
  });
});

describe("FeatureSwitchesService against a real database", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolOn: string;
  let schoolOff: string;

  beforeAll(async () => {
    schoolOn = (
      await basePrisma.school.create({
        data: {
          name: `Feature Spec On ${runId}`,
          slug: `feature-spec-on-${runId}`,
          featureSwitches: { "assistant-help": true },
        },
        select: { id: true },
      })
    ).id;
    schoolOff = (
      await basePrisma.school.create({
        data: { name: `Feature Spec Off ${runId}`, slug: `feature-spec-off-${runId}` },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await basePrisma.school.deleteMany({ where: { id: { in: [schoolOn, schoolOff] } } });
    await basePrisma.$disconnect();
  });

  it("a new school starts with every feature off (the column default is '{}')", async () => {
    const row = await basePrisma.school.findUniqueOrThrow({ where: { id: schoolOff }, select: { featureSwitches: true } });
    expect(row.featureSwitches).toEqual({});
    const svc = new FeatureSwitchesService(config({}));
    expect(await svc.isOn(schoolOff, "assistant-help")).toBe(false);
  });

  it("reads each school's own value, and one school's value never leaks to another", async () => {
    const svc = new FeatureSwitchesService(config({}));
    expect(await svc.isOn(schoolOn, "assistant-help")).toBe(true);
    expect(await svc.isOn(schoolOff, "assistant-help")).toBe(false);
  });

  it("FEATURES_DISABLED switches a key off for a school whose own entry is on", async () => {
    expect(await new FeatureSwitchesService(config({ FEATURES_DISABLED: "assistant-help" })).isOn(schoolOn, "assistant-help")).toBe(false);
    expect(await new FeatureSwitchesService(config({ FEATURES_DISABLED: "*" })).isOn(schoolOn, "assistant-help")).toBe(false);
    // An unknown name in the variable does not switch anything off.
    expect(await new FeatureSwitchesService(config({ FEATURES_DISABLED: "typo-key" })).isOn(schoolOn, "assistant-help")).toBe(true);
  });

  it("an unknown school id reads as off rather than throwing", async () => {
    const svc = new FeatureSwitchesService(config({}));
    expect(await svc.isOn("00000000-0000-0000-0000-000000000000", "assistant-help")).toBe(false);
  });

  it("caches within the TTL (no read while warm), and invalidate() or expiry picks up a change", async () => {
    let now = 1_000_000;
    const svc = new FeatureSwitchesService(config({}), () => now);
    expect(await svc.isOn(schoolOn, "assistant-help")).toBe(true);

    // Change the stored value behind the cache's back. A warm read must not
    // see it: proof the warm path makes no database query.
    await basePrisma.school.update({ where: { id: schoolOn }, data: { featureSwitches: { "assistant-help": false } } });
    expect(await svc.isOn(schoolOn, "assistant-help")).toBe(true);

    svc.invalidate(schoolOn);
    expect(await svc.isOn(schoolOn, "assistant-help")).toBe(false);

    await basePrisma.school.update({ where: { id: schoolOn }, data: { featureSwitches: { "assistant-help": true } } });
    expect(await svc.isOn(schoolOn, "assistant-help")).toBe(false); // still cached
    now += FEATURE_SWITCH_CACHE_TTL_MS + 1;
    expect(await svc.isOn(schoolOn, "assistant-help")).toBe(true); // expired, re-read
  });

  it("the database refuses a feature_switches value that is not an object", async () => {
    await expect(
      basePrisma.$executeRaw`UPDATE schools SET feature_switches = '[]'::jsonb WHERE id = ${schoolOff}`,
    ).rejects.toThrow(/schools_feature_switches_object/);
  });
});
