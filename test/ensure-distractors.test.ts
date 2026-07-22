import { describe, it, expect, vi, beforeEach } from "vitest";

const genMock = vi.fn(async (_word: string, _meaning: string) => [
  "干扰项甲",
  "干扰项乙",
  "干扰项丙",
]);

vi.mock("../src/deepseek.js", () => ({ generateDistractors: genMock }));

const AUTH = { authorization: "Bearer test-key" };

/**
 * 干扰项读时自愈。
 *
 * 划词插件入库不带干扰项,导致抽检退化成拿其它词的释义当选项。
 * 这里验证读取词本时会补齐并落库。
 */
describe("ensureDistractors", () => {
  beforeEach(() => {
    genMock.mockClear();
    genMock.mockImplementation(async () => ["干扰项甲", "干扰项乙", "干扰项丙"]);
  });

  it("干扰项为空的词被补齐并落库", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    addWord({ word: "plugword", translation: "n. 插件词" });
    expect(findWord("plugword")!.distractors).toEqual([]);

    const out = await ensureDistractors([findWord("plugword")!]);

    expect(out[0].distractors).toHaveLength(3);
    // 落库了,再读一次仍在
    expect(findWord("plugword")!.distractors).toEqual([
      "干扰项甲",
      "干扰项乙",
      "干扰项丙",
    ]);
  });

  it("已有干扰项的词不再调用 DS", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    addWord({
      word: "appword",
      translation: "n. 应用词",
      distractors: ["甲", "乙", "丙"],
    });
    await ensureDistractors([findWord("appword")!]);

    expect(genMock).not.toHaveBeenCalled();
  });

  it("DS 失败时保持为空且不抛错", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    genMock.mockImplementation(async () => {
      throw new Error("llm down");
    });
    addWord({ word: "failword", translation: "n. 失败词" });

    const out = await ensureDistractors([findWord("failword")!]);

    expect(out[0].distractors).toEqual([]);
    expect(findWord("failword")!.distractors).toEqual([]);
  });

  it("DS 返回不足 3 个时不落库", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    genMock.mockImplementation(async () => ["只有一个"]);
    addWord({ word: "shortword", translation: "n. 不足词" });

    await ensureDistractors([findWord("shortword")!]);

    expect(findWord("shortword")!.distractors).toEqual([]);
  });

  it("没有译文的词跳过,不浪费 DS 调用", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    addWord({ word: "notrans", translation: null });
    await ensureDistractors([findWord("notrans")!]);

    expect(genMock).not.toHaveBeenCalled();
  });
});

describe("GET /words", () => {
  beforeEach(() => {
    genMock.mockClear();
    genMock.mockImplementation(async () => ["干扰项甲", "干扰项乙", "干扰项丙"]);
  });

  it("all=1 返回全部未删除的词,且覆盖多个日期", async () => {
    const { addWord } = await import("../src/userdb.js");
    const { buildApp } = await import("../src/app.js");

    addWord({ word: "alphaword", translation: "n. 甲词" });
    addWord({ word: "betaword", translation: "n. 乙词" });

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/words?all=1", headers: AUTH });

    expect(res.statusCode).toBe(200);
    const words = res.json().words as { word: string }[];
    const names = words.map((w) => w.word);
    expect(names).toContain("alphaword");
    expect(names).toContain("betaword");
    await app.close();
  });

  it("软删除的词不出现在全量结果里", async () => {
    const { addWord, removeWord } = await import("../src/userdb.js");
    const { buildApp } = await import("../src/app.js");

    const w = addWord({ word: "goneword", translation: "n. 已删词" });
    removeWord(w.id);

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/words?all=1", headers: AUTH });
    const names = (res.json().words as { word: string }[]).map((x) => x.word);

    expect(names).not.toContain("goneword");
    await app.close();
  });

  it("既没有 date 也没有 all 时返回 400", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/words", headers: AUTH });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("按日期取词也会补齐干扰项", async () => {
    const { addWord } = await import("../src/userdb.js");
    const { buildApp } = await import("../src/app.js");

    const w = addWord({ word: "dateword", translation: "n. 当日词" });

    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/words?date=${w.addedDate}`,
      headers: AUTH,
    });
    const words = res.json().words as { word: string; distractors: string[] }[];
    const got = words.find((x) => x.word === "dateword");

    expect(got!.distractors).toHaveLength(3);
    await app.close();
  });
});
