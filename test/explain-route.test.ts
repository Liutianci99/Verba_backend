import { describe, it, expect, vi } from "vitest";

const explainMock = vi.fn(async (word: string) => ({
  generalMeaning: "跑；奔跑",
  contextMeaning: "一段连续的时期",
  pos: "n.",
  phrase: "a run of good luck",
  example: { en: "We had a long run of sunny days.", zh: "我们连着好多天都是晴天。" },
  lemma: word,
}));

vi.mock("../src/deepseek.js", () => ({ explainInContext: explainMock }));

const AUTH = { authorization: "Bearer test-key" };

describe("POST /explain", () => {
  it("合并 ECDICT 行(fixture 有 run)与 LLM 结果", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/explain",
      headers: AUTH,
      payload: { word: "run", sentence: "a long run of luck" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.word).toBe("run");
    expect(body.inflection).toBeNull(); // 本身即原形
    expect(body.phonetic).toBe("rʌn"); // 来自 ECDICT fixture
    expect(body.contextMeaning).toBe("一段连续的时期"); // 来自 LLM stub
    expect(body.ecdict.translation).toContain("跑");
    await app.close();
  });

  it("屈折形先还原成词根再送去解释", async () => {
    explainMock.mockClear();
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/explain",
      headers: AUTH,
      payload: { word: "running", sentence: "he is running fast" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.word).toBe("run"); // 入库以词根为准
    expect(body.queried).toBe("running"); // 用户实际选中的形式
    expect(body.inflection).toBe("现在分词");
    expect(body.phonetic).toBe("rʌn"); // 取到的是词根音标
    // 送给 LLM 的是词根,但句子保持原样以便判断语境
    expect(explainMock).toHaveBeenCalledWith("run", "he is running fast", expect.anything());
    await app.close();
  });

  it("LLM 未返回 lemma 字段时不应崩", async () => {
    explainMock.mockResolvedValueOnce({
      generalMeaning: "标准",
      contextMeaning: "准则",
      pos: "n.",
      phrase: "meet the criterion",
      example: { en: "It meets the criterion.", zh: "它符合该准则。" },
    } as never);
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/explain",
      headers: AUTH,
      payload: { word: "criteria", sentence: "the criteria are strict" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().word).toBe("criterion");
    await app.close();
  });

  it("缺 word 返回 400", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/explain",
      headers: AUTH,
      payload: { sentence: "x" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
