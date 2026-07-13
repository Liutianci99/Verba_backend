import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

const AUTH = { authorization: "Bearer test-key" };

describe("GET /words/:word/senses", () => {
  it("返回该词全部语境", async () => {
    const app = buildApp();
    await app.inject({
      method: "POST", url: "/words", headers: AUTH,
      payload: { word: "light", translation: "光", sense: { contextMeaning: "光线" } },
    });
    await app.inject({
      method: "POST", url: "/words", headers: AUTH,
      payload: { word: "light", translation: "光", sense: { contextMeaning: "轻的" } },
    });
    const res = await app.inject({ method: "GET", url: "/words/Light/senses", headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json().senses.map((s: { contextMeaning: string }) => s.contextMeaning)).toEqual(["光线", "轻的"]);
    await app.close();
  });
});
