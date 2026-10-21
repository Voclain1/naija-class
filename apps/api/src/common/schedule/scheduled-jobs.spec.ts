import { Injectable, Module } from "@nestjs/common";
import { Cron, SchedulerRegistry } from "@nestjs/schedule";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { scheduledJobsModules } from "./scheduled-jobs";

@Injectable()
class Nightly {
  @Cron("0 3 * * *", { name: "nightly" })
  run() {}
}

@Module({ providers: [Nightly] })
class Feature {}

async function cronJobsWith(env: { SCHEDULED_JOBS?: string }) {
  const moduleRef = await Test.createTestingModule({ imports: [...scheduledJobsModules(env), Feature] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  // Without ScheduleModule there is no registry at all, so no job can exist.
  let names: string[] = [];
  try {
    names = [...app.get(SchedulerRegistry, { strict: false }).getCronJobs().keys()];
  } catch {
    names = [];
  }
  await app.close();
  return names;
}

describe("scheduledJobsModules", () => {
  it("registers @Cron jobs by default", async () => {
    expect(await cronJobsWith({})).toEqual(["nightly"]);
  });

  it("registers none with SCHEDULED_JOBS=off", async () => {
    expect(scheduledJobsModules({ SCHEDULED_JOBS: "off" })).toEqual([]);
    expect(scheduledJobsModules({ SCHEDULED_JOBS: " OFF " })).toEqual([]);
    expect(await cronJobsWith({ SCHEDULED_JOBS: "off" })).toEqual([]);
  });
});
