import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("undici", () => ({ fetch: fetchMock }));

const AUTH = { authorization: "Bearer test-key" };

/** 包一份 DeepSeek chat/completions 的成功响应。 */
function dsReply(obj: unknown): unknown {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }),
    text: async () => "",
  };
}

const ORTHOGONALITY = {
  isWord: true,
  suggestion: null,
  phonetic: "/ˌɔːθɒɡəˈnælɪti/",
  translation: "n. 正交性",
  definition: "the property of being orthogonal",
  pos: "n.",
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("GET /dict/:word 的 DeepSeek 兜底", () => {
  it("ECDICT 命中时不调用 DeepSeek", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/dict/run", headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.json().source).toBe("ecdict");
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("未收录且 DeepSeek 判定为真词时返回词条,标记 source=llm", async () => {
    fetchMock.mockResolvedValueOnce(dsReply(ORTHOGONALITY));
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/dict/orthogonality",
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe("llm");
    expect(body.word).toBe("orthogonality");
    expect(body.queried).toBe("orthogonality");
    // ECDICT 落空即意味着 resolveLemma 也无结论,无词根可指
    expect(body.lemma).toBe("orthogonality");
    expect(body.inflection).toBeNull();
    expect(body.phonetic).toBe("/ˌɔːθɒɡəˈnælɪti/");
    expect(body.translation).toBe("n. 正交性");
    expect(body.definition).toContain("orthogonal");
    expect(body.pos).toBe("n.");
    // 考纲标签与词频是可查证的客观数据,编造出来就无法与 ECDICT 词条区分
    expect(body.tag).toBeNull();
    expect(body.collins).toBeNull();
    expect(body.frq).toBeNull();
    expect(body.exchange).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("DeepSeek 判定为拼写错误时返回 404 并附拼写建议", async () => {
    fetchMock.mockResolvedValueOnce(
      dsReply({
        isWord: false,
        suggestion: "receive",
        phonetic: null,
        translation: null,
        definition: null,
        pos: null,
      }),
    );
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/dict/recieve", headers: AUTH });

    expect(res.statusCode).toBe(404);
    // error 必须保留原值,两端已有的 404 降级路径依赖它
    expect(res.json().error).toBe("not found");
    expect(res.json().suggestion).toBe("receive");
    await app.close();
  });

  it("同一个词第二次查走缓存,不再调用 DeepSeek", async () => {
    fetchMock.mockResolvedValueOnce(
      dsReply({ ...ORTHOGONALITY, translation: "n. 幂等性" }),
    );
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();

    const first = await app.inject({ method: "GET", url: "/dict/idempotency", headers: AUTH });
    const second = await app.inject({ method: "GET", url: "/dict/idempotency", headers: AUTH });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("拼写错误的判定也进缓存,同一个错拼只花一次钱", async () => {
    fetchMock.mockResolvedValueOnce(
      dsReply({
        isWord: false,
        suggestion: "definitely",
        phonetic: null,
        translation: null,
        definition: null,
        pos: null,
      }),
    );
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();

    await app.inject({ method: "GET", url: "/dict/definately", headers: AUTH });
    const second = await app.inject({ method: "GET", url: "/dict/definately", headers: AUTH });

    expect(second.statusCode).toBe(404);
    expect(second.json().suggestion).toBe("definitely");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("DeepSeek 报错时返 404 而非 502", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/dict/quantumfoo", headers: AUTH });

    // 这条路由的语义是「查不到」,两端对 404 均已有降级路径;
    // 返 502 等于把仅存的降级路径也拆掉
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not found");
    await app.close();
  });

  it("非英文词形不送去 DeepSeek", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/dict/${encodeURIComponent("正交性")}`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("超长查询不送去 DeepSeek", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/dict/${"a".repeat(80)}`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });
});
