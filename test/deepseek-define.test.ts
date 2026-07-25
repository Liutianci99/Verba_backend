import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("undici", () => ({ fetch: fetchMock }));

beforeEach(() => {
  fetchMock.mockReset();
});

function bodyOf(call: number): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

describe("defineWord 的厂商约束", () => {
  it("用 config 里的模型,并留足思维链余量", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ isWord: true, translation: "n. 正交性", pos: "n." }),
            },
          },
        ],
      }),
      text: async () => "",
    });
    const { defineWord } = await import("../src/deepseek.js");
    const { config } = await import("../src/config.js");
    await defineWord("orthogonality");

    const body = bodyOf(0);
    expect(body.model).toBe(config.deepseekModel);
    // v4 是推理模型,思维链计入 completion_tokens,余量太薄会 finish_reason=length
    expect(body.max_tokens).toBeGreaterThanOrEqual(1200);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(body.messages)).toContain("orthogonality");
  });

  it("DeepSeek 返回非 JSON 时抛错,不返半成品", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "抱歉,我不确定" } }] }),
      text: async () => "",
    });
    const { defineWord } = await import("../src/deepseek.js");
    await expect(defineWord("zzzbogus")).rejects.toThrow();
  });

  it("判定为真词却没有中文释义时抛错", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          { message: { content: JSON.stringify({ isWord: true, translation: null }) } },
        ],
      }),
      text: async () => "",
    });
    const { defineWord } = await import("../src/deepseek.js");
    // 没有 translation 的词条对用户毫无价值,宁可当兜底失败走 404
    await expect(defineWord("orthogonality")).rejects.toThrow();
  });
});
