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

  it("客户端随入库带来的干扰项视为过期,由服务端按当前策略重生成", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    // App 加词时自带 distractors 走 addWord,服务端无从得知它由哪版 prompt
    // 生成,一律按过期处理,以自己的当前策略为准
    addWord({
      word: "appword",
      translation: "n. 应用词",
      distractors: ["甲", "乙", "丙"],
    });
    await ensureDistractors([findWord("appword")!]);

    expect(genMock).toHaveBeenCalled();
    expect(findWord("appword")!.distractors).toEqual([
      "干扰项甲",
      "干扰项乙",
      "干扰项丙",
    ]);
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

  it("清掉字符串内重复的词元(DS 偶发把同一个词吐三遍)", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    // 线上 parity 的真实产物
    genMock.mockImplementation(async () => [
      "部分 部分 部分",
      "对等 对等 对等",
      "奇偶性 奇偶性 奇偶性",
    ]);
    addWord({ word: "parityword", translation: "n. 同等" });

    await ensureDistractors([findWord("parityword")!]);

    expect(findWord("parityword")!.distractors).toEqual([
      "部分",
      "对等",
      "奇偶性",
    ]);
  });

  it("保留正常的多词释义,不误伤", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    // 线上 toggle 的真实产物,词元各不相同,应原样保留
    genMock.mockImplementation(async () => [
      "n. 把手 扣环 旋钮",
      "vt. 缠绕 系紧",
      "n. 开关 触发器 拨片",
    ]);
    addWord({ word: "toggleword", translation: "n. 套索钉" });

    await ensureDistractors([findWord("toggleword")!]);

    expect(findWord("toggleword")!.distractors).toEqual([
      "n. 把手 扣环 旋钮",
      "vt. 缠绕 系紧",
      "n. 开关 触发器 拨片",
    ]);
  });

  it("干扰项彼此重复或与正确答案相同时,清洗后不足 3 个则整体丢弃", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    genMock.mockImplementation(async () => ["甲", "甲", "n. 同义词"]);
    addWord({ word: "dupword", translation: "n. 同义词" });

    await ensureDistractors([findWord("dupword")!]);

    // 去重后剩「甲」,又剔掉与正确答案相同的一项 → 不足 3,不落库
    expect(findWord("dupword")!.distractors).toEqual([]);
  });

  it("已存的脏干扰项在读取时就地清洗,不消耗 DS 调用", async () => {
    const { addWord, findWord, setDistractors } = await import(
      "../src/userdb.js"
    );
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    // 当前策略生成、但清洗规则收紧前落库的脏数据
    addWord({ word: "dirtyword", translation: "n. 同等" });
    setDistractors("dirtyword", [
      "部分 部分 部分",
      "对等 对等 对等",
      "奇偶性 奇偶性 奇偶性",
    ]);
    genMock.mockClear();

    await ensureDistractors([findWord("dirtyword")!]);

    expect(findWord("dirtyword")!.distractors).toEqual([
      "部分",
      "对等",
      "奇偶性",
    ]);
    expect(genMock).not.toHaveBeenCalled();
  });

  it("已存的干扰项清洗后不足 3 个则重新生成", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    addWord({
      word: "thinword",
      translation: "n. 稀疏",
      distractors: ["甲", "甲", "甲"], // 去重后只剩 1 个
    });

    await ensureDistractors([findWord("thinword")!]);

    expect(genMock).toHaveBeenCalled();
    expect(findWord("thinword")!.distractors).toEqual([
      "干扰项甲",
      "干扰项乙",
      "干扰项丙",
    ]);
  });

  it("已经干净的干扰项不重复写库", async () => {
    const { addWord, findWord, setDistractors } = await import(
      "../src/userdb.js"
    );
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    addWord({ word: "cleanword", translation: "n. 干净" });
    setDistractors("cleanword", ["甲", "乙", "丙"]);
    genMock.mockClear();

    await ensureDistractors([findWord("cleanword")!]);

    expect(findWord("cleanword")!.distractors).toEqual(["甲", "乙", "丙"]);
    expect(genMock).not.toHaveBeenCalled();
  });

  it("旧策略生成的干扰项会被重新生成,哪怕它本身是干净的", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    // addWord 传入的 distractors 走老路径,版本号停留在 0
    addWord({
      word: "staleword",
      translation: "n. 标准尺寸",
      distractors: ["计量", "衡量", "测算"], // 旧策略产物:全是该词自身义项
    });

    await ensureDistractors([findWord("staleword")!]);

    expect(genMock).toHaveBeenCalled();
    expect(findWord("staleword")!.distractors).toEqual([
      "干扰项甲",
      "干扰项乙",
      "干扰项丙",
    ]);
  });

  it("当前策略生成的干扰项不重复调用 DS", async () => {
    const { addWord, findWord, setDistractors } = await import(
      "../src/userdb.js"
    );
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    addWord({ word: "freshword", translation: "n. 新词" });
    setDistractors("freshword", ["甲", "乙", "丙"]); // 走 setDistractors,版本号写当前值
    genMock.mockClear();

    await ensureDistractors([findWord("freshword")!]);

    expect(genMock).not.toHaveBeenCalled();
    expect(findWord("freshword")!.distractors).toEqual(["甲", "乙", "丙"]);
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
