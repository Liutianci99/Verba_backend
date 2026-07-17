import { describe, it, expect, vi } from "vitest";

vi.mock("../src/deepseek.js", () => ({
  translateText: vi.fn(async (text: string) =>
    text.includes("Cross-Sectional") ? "横截面算子" : "译文",
  ),
}));

const AUTH = { authorization: "Bearer test-key" };

describe("POST /translate", () => {
  it("返回整段中文译文", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/translate",
      headers: AUTH,
      payload: { text: "Cross-Sectional Operators" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().translation).toBe("横截面算子");
    await app.close();
  });

  it("缺 text 返回 400", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/translate", headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
