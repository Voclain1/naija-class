import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CBT_SIGNATURE_HEADER, deriveSyncKey, signSyncBody, type CbtSyncBatch } from "@school-kit/types";

import { choose, startAttempt } from "./attempt";
import { resetStoreConnection, saveAttempt, saveSyncKey } from "./store";
import { describeSync, syncSitting } from "./sync";

// The machine's side of answer sync, on fake-indexeddb with fetch stubbed:
// only unconfirmed copies are sent, they are signed over the exact body, a
// failure keeps them for next time, and a rejected one is not retried.

const t0 = new Date("2026-11-20T09:00:00.000Z");
let sent: CbtSyncBatch[] = [];

function serverThat(respond: (batch: CbtSyncBatch) => { status: number; body: unknown }) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const batch = JSON.parse(init.body as string) as CbtSyncBatch;
    sent.push(batch);
    const { status, body } = respond(batch);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
}

const storeAll = (batch: CbtSyncBatch) => ({
  status: 200,
  body: { results: batch.attempts.map((a) => ({ studentId: a.studentId, seq: a.seq, outcome: "STORED", reason: null })) },
});

describe("syncSitting", () => {
  let key: Awaited<ReturnType<typeof deriveSyncKey>>;

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    resetStoreConnection();
    sent = [];
    key = await deriveSyncKey("ABCD-EFGH-JKMN", "sit-1", 1_000);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends only what the server has not confirmed, signed over the exact body", async () => {
    const ada = choose(startAttempt("sit-1", "ada", "A", t0), "i1", "o1");
    await saveAttempt(ada);
    await saveAttempt(startAttempt("sit-1", "bayo", "B", t0));
    await saveAttempt(startAttempt("sit-2", "other", "A", t0)); // another sitting — not this batch
    const fetchMock = serverThat(storeAll);
    vi.stubGlobal("fetch", fetchMock);

    expect(await syncSitting("school", "sit-1", key)).toEqual({ kind: "SENT", pending: 0 });
    expect(sent[0]!.attempts.map((a) => [a.studentId, a.seq]).sort()).toEqual([["ada", 2], ["bayo", 1]]);
    const init = fetchMock.mock.calls[0]![1];
    const headers = init.headers as Record<string, string>;
    expect(headers[CBT_SIGNATURE_HEADER]).toBe(await signSyncBody(key, init.body as string));
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/cbt-delivery\/school\/sittings\/sit-1\/answers$/);

    // Nothing new → nothing sent. A new answer → only that student.
    expect(await syncSitting("school", "sit-1", key)).toEqual({ kind: "SENT", pending: 0 });
    expect(sent).toHaveLength(1);
    await saveAttempt(choose(ada, "i2", "o3"));
    await syncSitting("school", "sit-1", key);
    expect(sent[1]!.attempts.map((a) => [a.studentId, a.seq])).toEqual([["ada", 3]]);
  });

  it("offline: keeps everything and says so; then sends once the internet is back", async () => {
    await saveAttempt(startAttempt("sit-1", "ada", "A", t0));
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const state = await syncSitting("school", "sit-1", key);
    expect(state).toMatchObject({ kind: "PENDING", pending: 1, reason: "OFFLINE" });
    expect(describeSync(state)).toBe("1 student's answers saved on this computer — will send when the internet is back");

    vi.stubGlobal("fetch", serverThat(storeAll));
    expect(await syncSitting("school", "sit-1", key)).toEqual({ kind: "SENT", pending: 0 });
  });

  it("a rejected attempt is not sent again; a refused batch is kept with the server's reason", async () => {
    await saveAttempt(startAttempt("sit-1", "ghost", "A", t0));
    vi.stubGlobal(
      "fetch",
      serverThat((b) => ({ status: 200, body: { results: b.attempts.map((a) => ({ studentId: a.studentId, seq: a.seq, outcome: "REJECTED", reason: "NOT_ON_REGISTER" })) } })),
    );
    expect(await syncSitting("school", "sit-1", key)).toEqual({ kind: "SENT", pending: 0 });
    expect(await syncSitting("school", "sit-1", key)).toEqual({ kind: "SENT", pending: 0 });
    expect(sent).toHaveLength(1);

    await saveAttempt(startAttempt("sit-1", "ada", "A", t0));
    vi.stubGlobal("fetch", serverThat(() => ({ status: 401, body: { error: { code: "CBT_BAD_SIGNATURE", message: "Not unlocked." } } })));
    expect(await syncSitting("school", "sit-1", key)).toMatchObject({ kind: "PENDING", pending: 1, reason: "ERROR", message: "Not unlocked." });
  });

  it("after a restart it signs with the key it kept, and without one it waits for the unlock code", async () => {
    await saveAttempt(startAttempt("sit-1", "ada", "A", t0));
    vi.stubGlobal("fetch", serverThat(storeAll));
    expect(await syncSitting("school", "sit-1")).toMatchObject({ kind: "PENDING", reason: "NO_KEY" });
    expect(sent).toHaveLength(0);
    await saveSyncKey("sit-1", key);
    expect(await syncSitting("school", "sit-1")).toEqual({ kind: "SENT", pending: 0 });
  });
});

describe("isUnlockCode", () => {
  it("accepts the code the key came from, typed loosely, and nothing else", async () => {
    const { isUnlockCode } = await import("./invigilator");
    const key = await deriveSyncKey("ABCD-EFGH-JKMN", "sit-1", 1_000);
    expect(await isUnlockCode("abcd efgh jkmn", "sit-1", 1_000, key)).toBe(true);
    expect(await isUnlockCode("ABCD-EFGH-JKMP", "sit-1", 1_000, key)).toBe(false);
  });
});

describe("deviceId", () => {
  it("is one id per machine, even when asked for twice at once", async () => {
    globalThis.indexedDB = new IDBFactory();
    resetStoreConnection();
    const { deviceId } = await import("./store");
    const [a, b] = await Promise.all([deviceId(), deviceId()]);
    expect(a).toBe(b);
    resetStoreConnection(); // a fresh page load on the same machine
    expect(await deviceId()).toBe(a);
  });
});
