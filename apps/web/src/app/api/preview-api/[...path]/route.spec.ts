import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue } = vi.hoisted(() => ({ cookieValue: { current: "tok_123" as string | undefined } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "sk_session" && cookieValue.current ? { value: cookieValue.current } : undefined),
  }),
}));

import { GET, POST } from "./route";

const ORIGIN = "https://school-kit-web-git-x.vercel.app";
const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });

describe("/api/preview-api (preview deployments only)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    cookieValue.current = "tok_123";
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.schoolkit.ng/api/v1");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("answers 404 outside a preview, without calling the API", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await GET(new NextRequest(`${ORIGIN}/api/preview-api/students`), ctx(["students"]));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a read with the session cookie as a bearer token, keeping the query", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ id: "s1" }]), { headers: { "content-type": "application/json" } }));
    const res = await GET(new NextRequest(`${ORIGIN}/api/preview-api/students?page=2`), ctx(["students"]));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "s1" }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.schoolkit.ng/api/v1/students?page=2");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok_123");
  });

  it("refuses a write from another origin", async () => {
    const res = await POST(
      new NextRequest(`${ORIGIN}/api/preview-api/users/invite`, {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: "{}",
      }),
      ctx(["users", "invite"]),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a same-origin write with its body and status", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: "EMAIL_TAKEN", message: "x" } }), { status: 409 }));
    const res = await POST(
      new NextRequest(`${ORIGIN}/api/preview-api/users/invite`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.test" }),
      }),
      ctx(["users", "invite"]),
    );
    expect(res.status).toBe(409);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"email":"a@b.test"}');
  });

  it("sends no Authorization header when there is no session cookie", async () => {
    cookieValue.current = undefined;
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    await GET(new NextRequest(`${ORIGIN}/api/preview-api/users`), ctx(["users"]));
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).has("authorization")).toBe(false);
  });
});
