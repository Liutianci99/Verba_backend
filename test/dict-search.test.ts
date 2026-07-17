import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

const AUTH = { authorization: "Bearer test-key" };

describe("GET /dict/search 模糊查询", () => {
  it("前缀匹配命中(fixture 有 run)", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/dict/search?q=ru",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const words = res.json().matches.map((m: { word: string }) => m.word);
    expect(words).toContain("run");
    await app.close();
  });

  it("缺 q 返回 400", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/dict/search", headers: AUTH });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
