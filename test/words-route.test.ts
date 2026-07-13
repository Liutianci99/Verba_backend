import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { sensesByWord } from "../src/userdb.js";

const AUTH = { authorization: "Bearer test-key" };

describe("POST /words 带 sense", () => {
  it("保存后 word_senses 有对应语境", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/words",
      headers: AUTH,
      payload: {
        word: "Run",
        translation: "跑；经营",
        sense: { contextMeaning: "一段连续的时期", contextSentence: "a long run of luck" },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().word).toBe("run"); // 归一化小写
    const senses = sensesByWord("run");
    expect(senses.at(-1)?.contextMeaning).toBe("一段连续的时期");
    await app.close();
  });
});
