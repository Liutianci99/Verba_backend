import { describe, it, expect, vi } from "vitest";

const MP3 = Buffer.from("ID3fake-mp3-bytes");

vi.mock("../src/tts.js", () => ({
  US_VOICE: "af_heart",
  UK_VOICE: "bf_emma",
  getAudio: vi.fn(async (_text: string, _voice: string) => ({ buf: MP3, cached: false })),
}));

const AUTH = { authorization: "Bearer test-key" };

describe("GET /audio/:word", () => {
  it("返回 MP3,带长缓存头与 ETag", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/audio/directionality", headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/mpeg");
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.headers["etag"]).toBeTruthy();
    expect(res.rawPayload.equals(MP3)).toBe(true);
    await app.close();
  });

  it("默认美音,type=1 切英音", async () => {
    const { getAudio } = await import("../src/tts.js");
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();

    await app.inject({ method: "GET", url: "/audio/run", headers: AUTH });
    expect(vi.mocked(getAudio)).toHaveBeenLastCalledWith("run", "af_heart");

    await app.inject({ method: "GET", url: "/audio/run?type=1", headers: AUTH });
    expect(vi.mocked(getAudio)).toHaveBeenLastCalledWith("run", "bf_emma");
    await app.close();
  });

  it("ETag 命中返回 304", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const first = await app.inject({ method: "GET", url: "/audio/hedge", headers: AUTH });
    const res = await app.inject({
      method: "GET",
      url: "/audio/hedge",
      headers: { ...AUTH, "if-none-match": first.headers["etag"] as string },
    });
    expect(res.statusCode).toBe(304);
    await app.close();
  });

  it("超长文本返回 413", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/audio/${"a".repeat(601)}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(413);
    await app.close();
  });

  it("合成失败返回 502", async () => {
    const { getAudio } = await import("../src/tts.js");
    vi.mocked(getAudio).mockRejectedValueOnce(new Error("tts down"));
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/audio/boom", headers: AUTH });
    expect(res.statusCode).toBe(502);
    await app.close();
  });

  it("未鉴权返回 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/audio/run" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
