import type { ConfigService } from "@nestjs/config";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  CBT_SIGNATURE_HEADER,
  WrongUnlockCodeError,
  deriveSyncKey,
  openPackInBrowser,
  signSyncBody,
  type CbtAttemptSnapshot,
  type CbtPackEnvelope,
  type CbtPackPayload,
  type CbtSyncResultDto,
} from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { EmbeddingService } from "../../common/embeddings/embedding.service.js";
import { HttpExceptionFilter } from "../../common/http-exception.filter.js";
import { AuthService } from "../auth/auth.service.js";
import { CbtSittingsService } from "../cbt/cbt-sittings.service.js";
import { CurriculumRetrievalService } from "../curriculum/curriculum-retrieval.service.js";
import { ExamPapersService } from "../exam-papers/exam-papers.service.js";
import { QuestionBankService } from "../question-bank/question-bank.service.js";
import { CbtDeliveryModule } from "./cbt-delivery.module.js";

// Online exams (CBT2) — the lab machine's two public calls, over real HTTP and
// real Postgres, with the BROWSER's crypto (`@school-kit/types`
// cbt-web-crypto.ts, running on Node's WebCrypto) on the machine's side. The
// risks (docs/modules/cbt.md):
//   * the browser opens the pack the server built, and only with the code;
//   * only a machine holding the unlock code can send answers (signature over
//     the exact bytes sent);
//   * the highest snapshot wins, so repeats, late batches and races change
//     nothing, and a submitted attempt is final;
//   * an answer must be on the paper, a student on the register;
//   * once answers exist, the sitting can't go back to draft (D2).

const runId = Math.random().toString(36).slice(2, 8);
const slug = `cbtd-${runId}`;
const meta = { ipAddress: "127.0.0.1" };
const configStub = () => ({ get: () => undefined }) as unknown as ConfigService;
const hour = 3_600_000;
const DEVICE_1 = "11111111-1111-4111-8111-111111111111";
const DEVICE_2 = "22222222-2222-4222-8222-222222222222";

describe("CBT delivery — pack download and answer sync over HTTP", () => {
  const bank = new QuestionBankService(
    new AiGenerationService(configStub(), { create: async () => ({ text: "", inputTokens: 0, outputTokens: 0, stopReason: "end_turn" }) }),
    new CurriculumRetrievalService(new EmbeddingService(configStub())),
  );
  const papers = new ExamPapersService(bank);
  const sittings = new CbtSittingsService(bank);
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let S: { schoolId: string; owner: { sessionId: string; schoolId: string; userId: string }; paperId: string; armId: string; outsiderId: string };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), CbtDeliveryModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    // As in main.ts: the signature is checked against the raw bytes.
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = request(app.getHttpServer());

    const signed = await new AuthService().signupOwner(
      {
        schoolName: `CBT delivery ${runId}`,
        schoolSlug: slug,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `cbtd-${runId}@example.test`,
        ownerPhone: `+23497${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    const schoolId = signed.school.id;
    await basePrisma.school.update({ where: { id: schoolId }, data: { status: "ACTIVE", onboardingStep: 5 } });
    const owner = { sessionId: `sess-${runId}`, schoolId, userId: signed.user.id };

    const base = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31") },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2026-09-01"), endDate: new Date("2026-12-11") },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "Gold", code: `cbtd-${runId}` } });
      const subject = await db.subject.create({ data: { schoolId, name: `Chemistry ${runId}`, code: `CHM-${runId}` } });
      for (const [i, [firstName, lastName]] of [["Ada", "Okafor"], ["Bayo", "Adeyemi"]].entries()) {
        const student = await db.student.create({
          data: { schoolId, admissionNumber: `CBTD/${runId}/${i}`, firstName: firstName!, lastName: lastName!, dateOfBirth: new Date("2012-01-01"), gender: "FEMALE" },
        });
        await db.enrollment.create({ data: { schoolId, studentId: student.id, termId: term.id, academicYearId: year.id, classArmId: arm.id } });
      }
      // Not enrolled in the arm: never on the register.
      const outsider = await db.student.create({
        data: { schoolId, admissionNumber: `CBTD/${runId}/x`, firstName: "Uche", lastName: "Outside", dateOfBirth: new Date("2012-01-01"), gender: "MALE" },
      });
      return { term, level, arm, subject, outsiderId: outsider.id };
    });

    const at = { subjectId: base.subject.id, classLevelId: base.level.id };
    const mcq = async (text: string) =>
      (
        await bank.approve(
          owner,
          (
            await bank.create(
              owner,
              {
                ...at,
                topic: "Matter",
                type: "MULTIPLE_CHOICE",
                difficulty: "EASY",
                text,
                marks: 1,
                answerGuide: null,
                options: ["Solid", "Liquid", "Gas"].map((t, i) => ({ text: `${t} (${text})`, isCorrect: i === 0 })),
              },
              meta,
            )
          ).id,
          meta,
        )
      ).id;
    const questionIds = [await mcq("Ice is a"), await mcq("Steam is a")];
    const paper = await papers.create(owner, { ...at, termId: base.term.id, title: "Chemistry CBT", durationMinutes: 30, versionCount: 2 }, meta);
    await papers.save(owner, paper.id, { title: "Chemistry CBT", durationMinutes: 30, instructions: null, componentId: null, versionCount: 2, sections: [{ title: "A", questionIds }] }, meta);
    await papers.finalise(owner, paper.id, meta);

    S = { schoolId, owner, paperId: paper.id, armId: base.arm.id, outsiderId: base.outsiderId };
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    if (!S) return;
    await basePrisma.school.update({ where: { id: S.schoolId }, data: { deletionStartedAt: new Date() } }).catch(() => undefined);
    // cbt_attempts → cbt_candidates is RESTRICT; clear attempts before the cascade.
    await withTenant(S.schoolId, (db) => db.cbtAttempt.deleteMany({})).catch(() => undefined);
    await basePrisma.school.delete({ where: { id: S.schoolId } }).catch(() => undefined);
  });

  /** A published sitting, its codes, and the pack as a machine downloads it. */
  async function published(startInHours = 24) {
    const start = Date.now() + startInHours * hour;
    const draft = await sittings.create(
      S.owner,
      { paperId: S.paperId, title: "Chemistry online", classArmIds: [S.armId], startsAt: new Date(start).toISOString(), windowEndsAt: new Date(start + hour).toISOString(), durationMinutes: 30 },
      meta,
    );
    await sittings.publish(S.owner, draft.id, meta);
    const sheet = await sittings.invigilatorSheet(S.owner, draft.id, meta);
    const res = await http.get(`/api/v1/cbt-delivery/${slug}/packs/${sheet.accessCode.toLowerCase()}`).expect(200);
    const envelope = res.body.envelope as CbtPackEnvelope;
    const payload = await openPackInBrowser(envelope, sheet.unlockCode);
    const key = await deriveSyncKey(sheet.unlockCode, draft.id, envelope.kdf.iterations);
    return { id: draft.id, sheet, envelope, payload, key };
  }

  function snapshot(payload: CbtPackPayload, studentId: string, seq: number, pick: number[], extra: Partial<CbtAttemptSnapshot> = {}): CbtAttemptSnapshot {
    const version = payload.candidates.find((c) => c.studentId === studentId)?.version ?? "A";
    const questions = payload.versions[version]!.flatMap((s) => s.questions);
    const answers: Record<string, string> = {};
    pick.forEach((optionIndex, q) => {
      answers[questions[q]!.itemId] = questions[q]!.options[optionIndex]!.id;
    });
    return { studentId, seq, startedAt: new Date().toISOString(), submittedAt: null, extraMinutes: 0, focusLosses: 0, answers, ...extra };
  }

  async function send(sittingId: string, key: Awaited<ReturnType<typeof deriveSyncKey>>, deviceId: string, attempts: CbtAttemptSnapshot[]) {
    const body = JSON.stringify({ deviceId, attempts });
    const res = await http
      .post(`/api/v1/cbt-delivery/${slug}/sittings/${sittingId}/answers`)
      .set("Content-Type", "application/json")
      .set(CBT_SIGNATURE_HEADER, await signSyncBody(key, body))
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res as { body: CbtSyncResultDto };
  }

  const outcomes = (res: { body: CbtSyncResultDto }) => res.body.results.map((r) => r.outcome);
  const attempts = (sittingId: string) =>
    withTenant(S.schoolId, (db) => db.cbtAttempt.findMany({ where: { sittingId }, orderBy: { deviceId: "asc" } }));

  it("the browser opens the server's pack with the unlock code, and only with it", async () => {
    const { envelope, payload, sheet } = await published();
    expect(payload.candidates).toHaveLength(2);
    expect(payload.questionCount).toBe(2);
    expect(JSON.stringify(payload)).not.toMatch(/isCorrect/);
    await expect(openPackInBrowser(envelope, "AAAA-AAAA-AAAA")).rejects.toBeInstanceOf(WrongUnlockCodeError);
    // Typed loosely — lower case, spaces — still opens.
    await expect(openPackInBrowser(envelope, sheet.unlockCode.toLowerCase().replace(/-/g, " "))).resolves.toBeTruthy();
  });

  it("download: a wrong code, a draft, an unknown school, a closed exam and a suspended school are refused", async () => {
    await http.get(`/api/v1/cbt-delivery/${slug}/packs/ZZZZZZ`).expect(404);
    await http.get(`/api/v1/cbt-delivery/no-such-school-${runId}/packs/ZZZZZZ`).expect(404);

    const draft = await sittings.create(
      S.owner,
      { paperId: S.paperId, title: "Draft", classArmIds: [S.armId], startsAt: new Date(Date.now() + 24 * hour).toISOString(), windowEndsAt: new Date(Date.now() + 25 * hour).toISOString(), durationMinutes: 30 },
      meta,
    );
    const code = await withTenant(S.schoolId, (db) => db.cbtSitting.findUniqueOrThrow({ where: { id: draft.id }, select: { accessCode: true } }));
    await http.get(`/api/v1/cbt-delivery/${slug}/packs/${code.accessCode}`).expect(404);

    const p = await published();
    await sittings.close(S.owner, p.id, meta);
    const closed = await http.get(`/api/v1/cbt-delivery/${slug}/packs/${p.sheet.accessCode}`).expect(409);
    expect(closed.body.error.code).toBe("SITTING_CLOSED");

    const open = await published();
    await basePrisma.school.update({ where: { id: S.schoolId }, data: { suspendedAt: new Date() } });
    try {
      const res = await http.get(`/api/v1/cbt-delivery/${slug}/packs/${open.sheet.accessCode}`).expect(403);
      expect(res.body.error.code).toBe("SCHOOL_SUSPENDED");
    } finally {
      await basePrisma.school.update({ where: { id: S.schoolId }, data: { suspendedAt: null } });
    }
  });

  it("answers are accepted only when signed by an unlocked machine, over the exact bytes sent", async () => {
    const p = await published();
    const student = p.payload.candidates[0]!.studentId;
    const body = JSON.stringify({ deviceId: DEVICE_1, attempts: [snapshot(p.payload, student, 1, [0, 1])] });
    const url = `/api/v1/cbt-delivery/${slug}/sittings/${p.id}/answers`;

    const unsigned = await http.post(url).set("Content-Type", "application/json").send(body).expect(401);
    expect(unsigned.body.error.code).toBe("CBT_BAD_SIGNATURE");

    // A key from a different code — e.g. guessed — is refused.
    const wrongKey = await deriveSyncKey("AAAA-AAAA-AAAA", p.id, p.envelope.kdf.iterations);
    await http.post(url).set("Content-Type", "application/json").set(CBT_SIGNATURE_HEADER, await signSyncBody(wrongKey, body)).send(body).expect(401);

    // The right key over DIFFERENT bytes (a tampered batch) is refused.
    const tampered = body.replace('"seq":1', '"seq":2');
    await http.post(url).set("Content-Type", "application/json").set(CBT_SIGNATURE_HEADER, await signSyncBody(p.key, body)).send(tampered).expect(401);

    // Another sitting's key is refused here.
    const other = await published();
    await http.post(url).set("Content-Type", "application/json").set(CBT_SIGNATURE_HEADER, await signSyncBody(other.key, body)).send(body).expect(401);

    expect(await attempts(p.id)).toHaveLength(0);
    const ok = await send(p.id, p.key, DEVICE_1, [snapshot(p.payload, student, 1, [0, 1])]);
    expect(outcomes(ok)).toEqual(["STORED"]);
  });

  it("the highest snapshot wins: repeats and late batches change nothing, and a submitted attempt is final", async () => {
    const p = await published();
    const student = p.payload.candidates[0]!.studentId;
    expect(outcomes(await send(p.id, p.key, DEVICE_1, [snapshot(p.payload, student, 3, [0])]))).toEqual(["STORED"]);
    // The same batch again, then an older one arriving late.
    expect(outcomes(await send(p.id, p.key, DEVICE_1, [snapshot(p.payload, student, 3, [0])]))).toEqual(["ALREADY_STORED"]);
    expect(outcomes(await send(p.id, p.key, DEVICE_1, [snapshot(p.payload, student, 2, [1, 1])]))).toEqual(["ALREADY_STORED"]);
    let [row] = await attempts(p.id);
    expect(row).toMatchObject({ seq: 3, answeredCount: 1, submittedAt: null });

    const submittedAt = new Date().toISOString();
    expect(outcomes(await send(p.id, p.key, DEVICE_1, [snapshot(p.payload, student, 5, [2, 0], { submittedAt, focusLosses: 2 })]))).toEqual(["STORED"]);
    expect(outcomes(await send(p.id, p.key, DEVICE_1, [snapshot(p.payload, student, 9, [1, 1])]))).toEqual(["ALREADY_STORED"]);
    [row] = await attempts(p.id);
    expect(row).toMatchObject({ seq: 5, answeredCount: 2, focusLosses: 2 });
    expect(row!.submittedAt?.toISOString()).toBe(submittedAt);
    expect(row!.lastReceivedAt.getTime()).toBeGreaterThanOrEqual(row!.firstReceivedAt.getTime());
    // The machine's start time is stored as sent, not shifted by a time zone.
    expect(Math.abs(row!.startedAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("the same student on two machines keeps both attempts (D5)", async () => {
    const p = await published();
    const student = p.payload.candidates[1]!.studentId;
    await send(p.id, p.key, DEVICE_1, [snapshot(p.payload, student, 1, [0])]);
    await send(p.id, p.key, DEVICE_2, [snapshot(p.payload, student, 1, [1])]);
    expect((await attempts(p.id)).map((a) => a.deviceId)).toEqual([DEVICE_1, DEVICE_2]);
    // Staff see it on the student list: two machines, the furthest one's count.
    const row = (await sittings.candidates(S.owner, p.id)).find((c) => c.studentId === student)!;
    expect(row.progress).toMatchObject({ machines: 2, answeredCount: 1, submitted: false });
  });

  it("rejects a student not on the register and an answer that is not on the paper, and keeps the rest of the batch", async () => {
    const p = await published();
    const [a, b] = p.payload.candidates;
    const forged = snapshot(p.payload, b!.studentId, 1, [0]);
    forged.answers[Object.keys(forged.answers)[0]!] = "not-an-option";
    const res = await send(p.id, p.key, DEVICE_1, [
      snapshot(p.payload, S.outsiderId, 1, [0]),
      forged,
      snapshot(p.payload, a!.studentId, 1, [0, 0]),
    ]);
    expect(res.body.results.map((r) => [r.outcome, r.reason])).toEqual([
      ["REJECTED", "NOT_ON_REGISTER"],
      ["REJECTED", "UNKNOWN_ANSWER"],
      ["STORED", null],
    ]);
    expect(await attempts(p.id)).toHaveLength(1);
  });

  it("a closed exam still keeps late answers; once answers exist the exam can't go back to draft", async () => {
    const p = await published();
    const student = p.payload.candidates[0]!.studentId;
    await send(p.id, p.key, DEVICE_1, [snapshot(p.payload, student, 1, [0])]);
    await expect(sittings.unpublish(S.owner, p.id, meta)).rejects.toMatchObject({ code: "SITTING_HAS_ANSWERS" });

    await sittings.close(S.owner, p.id, meta);
    const late = await send(p.id, p.key, DEVICE_2, [snapshot(p.payload, student, 1, [1])]);
    expect(outcomes(late)).toEqual(["STORED"]);
  });

  it("refuses a malformed batch before anything is stored", async () => {
    const p = await published();
    const body = JSON.stringify({ deviceId: "not-a-uuid", attempts: [] });
    await http
      .post(`/api/v1/cbt-delivery/${slug}/sittings/${p.id}/answers`)
      .set("Content-Type", "application/json")
      .set(CBT_SIGNATURE_HEADER, await signSyncBody(p.key, body))
      .send(body)
      .expect(400);
  });
});
