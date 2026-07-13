import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

describe("health + auth", () => {
  it("GET /health 免鉴权返回 ok", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("业务接口缺 token 返回 401", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/words?date=2026-07-12" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
