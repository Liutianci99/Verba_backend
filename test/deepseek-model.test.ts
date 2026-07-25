import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("undici", () => ({ fetch: fetchMock }));

beforeEach(() => fetchMock.mockReset());

function bodyOf(call: number) {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

/**
 * DeepSeek 于 2026-07 下线了 `deepseek-chat` 别名,只接受 deepseek-v4-pro /
 * deepseek-v4-flash,旧名一律 400 —— 表现为 /explain 与 /translate 齐齐返 502。
 * v4 是推理模型,思维链计入 completion_tokens,所以 max_tokens 还得留出余量,
 * 否则 JSON 会被截断,又变成另一种 502。这两条都用断言钉住。
 */
describe("DeepSeek v4 适配", () => {
  it("默认模型不能是已下线的别名", async () => {
    const { config } = await import("../src/config.js");
    expect(config.deepseekModel).toMatch(/^deepseek-v4-(pro|flash)$/);
  });

  it("explain 的 max_tokens 要能容纳思维链", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ generalMeaning: "叶", contextMeaning: "落叶" }),
            },
          },
        ],
      }),
    });
    const { explainInContext } = await import("../src/deepseek.js");
    await explainInContext("leaf", "The leaves fell.", null, "leaves");

    const body = bodyOf(0);
    const { config } = await import("../src/config.js");
    expect(body.model).toBe(config.deepseekModel);
    // 实测 flash 最坏情况(带词形歧义说明)用到 269,pro 用到 361
    expect(body.max_tokens).toBeGreaterThanOrEqual(1200);
  });

  it("translate 的 max_tokens 要能容纳思维链", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "译文" } }] }),
    });
    const { translateText } = await import("../src/deepseek.js");
    await translateText("a".repeat(400));

    // 实测 447 字符输入在 flash 上耗掉 391(其中思维链 331)
    expect(bodyOf(0).max_tokens).toBeGreaterThanOrEqual(2000);
  });
});
