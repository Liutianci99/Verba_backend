import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("undici", () => ({ fetch: fetchMock }));

beforeEach(() => fetchMock.mockReset());

function llmJson(obj: unknown) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }),
  };
}

describe("explainInContext", () => {
  it("解析 LLM 的 JSON 为 ExplainResult", async () => {
    fetchMock.mockResolvedValue(
      llmJson({
        generalMeaning: "跑；奔跑",
        contextMeaning: "一段连续的时期",
        pos: "n.",
        phrase: "a run of good luck",
        example: { en: "We had a long run of sunny days.", zh: "我们连着好多天都是晴天。" },
      }),
    );
    const { explainInContext } = await import("../src/deepseek.js");
    const r = await explainInContext("run", "a long run of luck", {
      translation: "n. 跑；一段连续的时期", definition: "to move fast", pos: "n",
    });
    expect(r.generalMeaning).toBe("跑；奔跑");
    expect(r.contextMeaning).toBe("一段连续的时期");
    expect(r.example.zh).toContain("晴天");
    // prompt 里带上了 ECDICT 候选义项
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toContain("一段连续的时期");
  });

  it("LLM 返回非法 JSON 抛错", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "不是JSON" } }] }) });
    const { explainInContext } = await import("../src/deepseek.js");
    await expect(explainInContext("x", "y", null)).rejects.toThrow();
  });
});
