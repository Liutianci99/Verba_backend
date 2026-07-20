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
    // 词根、原句、以及用户选中的原始形式都要给到 LLM ——
    // 少了最后一项,模型就无从纠正词典对歧义形的误判
    expect(explainMock).toHaveBeenCalledWith(
      "run",
      "he is running fast",
      expect.anything(),
      "running",
    );
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

  it("歧义屈折形:LLM 依句子改判,且须经词典交叉验证", async () => {
    // fixture 里 run 的 exchange 含 i:running,故 running→run 可被证实
    explainMock.mockResolvedValueOnce({
      generalMeaning: "跑",
      contextMeaning: "跑",
      pos: "v.",
      phrase: "run fast",
      example: { en: "He runs.", zh: "他跑。" },
      lemma: "run",
    } as never);
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({
      method: "POST", url: "/explain", headers: AUTH,
      payload: { word: "running", sentence: "he is running" },
    });
    expect(res.json().word).toBe("run");
    await app.close();
  });

  it("LLM 臆造的词根不被采纳,回落到词典结论", async () => {
    explainMock.mockResolvedValueOnce({
      generalMeaning: "跑",
      contextMeaning: "跑",
      pos: "v.",
      phrase: "x",
      example: { en: "x", zh: "x" },
      lemma: "zzzbogus", // 词典里没有,且无法证实 running 是它的屈折形
    } as never);
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({
      method: "POST", url: "/explain", headers: AUTH,
      payload: { word: "running", sentence: "he is running" },
    });
    expect(res.json().word).toBe("run"); // 仍是 ECDICT 的结论
    await app.close();
  });
});
