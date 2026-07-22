import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DistractorCandidate } from "../src/deepseek.js";

const FULL: DistractorCandidate[] = [
  { kind: "形近", word: "b1", meaning: "干扰项甲" },
  { kind: "形近", word: "b2", meaning: "干扰项乙" },
  { kind: "同领域", word: "b3", meaning: "干扰项丙" },
  { kind: "形近", word: "b4", meaning: "干扰项丁" },
  { kind: "同领域", word: "b5", meaning: "干扰项戊" },
];

const genMock = vi.fn(
  async (_word: string, _meaning: string): Promise<DistractorCandidate[]> =>
    FULL,
);

vi.mock("../src/deepseek.js", () => ({ generateDistractors: genMock }));

const AUTH = { authorization: "Bearer test-key" };

/**
 * 干扰项读时自愈。
 *
 * 划词插件入库不带干扰项,导致抽检退化成拿其它词的释义当选项。
 * 这里验证读取词本时会补齐、清洗、并按类别配额挑选。
 */
describe("ensureDistractors", () => {
  beforeEach(() => {
    genMock.mockClear();
    genMock.mockImplementation(async () => FULL);
  });

  it("干扰项为空的词被补齐并落库,按 2 形近 + 1 同领域挑选", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    addWord({ word: "plugword", translation: "n. 插件词" });
    expect(findWord("plugword")!.distractors).toEqual([]);

    const out = await ensureDistractors([findWord("plugword")!]);

    // 前两个形近 + 第一个同领域,备用的丁/戊不用
    expect(out[0].distractors).toEqual(["干扰项甲", "干扰项乙", "干扰项丙"]);
    expect(findWord("plugword")!.distractors).toEqual([
      "干扰项甲",
      "干扰项乙",
      "干扰项丙",
    ]);
  });

  it("正确答案被 DS 当成干扰项吐回来时剔除,由备用候选补位", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    // 线上 volatility 的真实故障:DS 把「波动性」这个正确答案原样吐了回来
    genMock.mockImplementation(async () => [
      { kind: "形近", word: "x1", meaning: "波动性" },
      { kind: "形近", word: "x2", meaning: "意志力" },
      { kind: "同领域", word: "x3", meaning: "生命力" },
      { kind: "形近", word: "x4", meaning: "挥发油" },
      { kind: "同领域", word: "x5", meaning: "流动性" },
    ]);
    addWord({ word: "volatileword", translation: "波动性" });

    await ensureDistractors([findWord("volatileword")!]);

    const got = findWord("volatileword")!.distractors;
    expect(got).not.toContain("波动性");
    expect(got).toHaveLength(3);
  });

  it("撞上 ECDICT 里该词其它义项的候选被否决", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    // fixture 里 hedge 的 ECDICT 释义是「n. 树篱 / vt. 对冲」。
    // 存的泛意只有「对冲」,若只比对它,「树篱」会漏网 —— 正是线上 parity
    // 拿到「奇偶性」的成因。
    genMock.mockImplementation(async () => [
      { kind: "形近", word: "y1", meaning: "树篱" },
      { kind: "形近", word: "y2", meaning: "壁架" },
      { kind: "同领域", word: "y3", meaning: "期货" },
      { kind: "形近", word: "y4", meaning: "楔子" },
      { kind: "同领域", word: "y5", meaning: "期权" },
    ]);
    addWord({ word: "hedge", translation: "对冲" });

    await ensureDistractors([findWord("hedge")!]);

    const got = findWord("hedge")!.distractors;
    expect(got).not.toContain("树篱");
    expect(got).toHaveLength(3);
  });

  it("某一类候选不够时用另一类补满", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    genMock.mockImplementation(async () => [
      { kind: "形近", word: "z1", meaning: "甲" },
      { kind: "同领域", word: "z2", meaning: "乙" },
      { kind: "同领域", word: "z3", meaning: "丙" },
    ]);
    addWord({ word: "skewword", translation: "n. 偏斜" });

    await ensureDistractors([findWord("skewword")!]);

    expect(findWord("skewword")!.distractors).toEqual(["甲", "乙", "丙"]);
  });

  it("清掉字符串内重复的词元(DS 偶发把同一个词吐三遍)", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    genMock.mockImplementation(async () => [
      { kind: "形近", word: "p1", meaning: "部分 部分 部分" },
      { kind: "形近", word: "p2", meaning: "对等 对等 对等" },
      { kind: "同领域", word: "p3", meaning: "奇偶性 奇偶性 奇偶性" },
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

    genMock.mockImplementation(async () => [
      { kind: "形近", word: "t1", meaning: "把手 扣环 旋钮" },
      { kind: "形近", word: "t2", meaning: "缠绕 系紧" },
      { kind: "同领域", word: "t3", meaning: "开关 触发器 拨片" },
    ]);
    addWord({ word: "toggleword", translation: "n. 套索钉" });

    await ensureDistractors([findWord("toggleword")!]);

    expect(findWord("toggleword")!.distractors).toEqual([
      "把手 扣环 旋钮",
      "缠绕 系紧",
      "开关 触发器 拨片",
    ]);
  });

  it("清洗后不足 3 个则整体丢弃,不落半套数据", async () => {
    const { addWord, findWord } = await import("../src/userdb.js");
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

    genMock.mockImplementation(async () => [
      { kind: "形近", word: "d1", meaning: "甲" },
      { kind: "形近", word: "d2", meaning: "甲" },
      { kind: "同领域", word: "d3", meaning: "同义词" },
    ]);
    addWord({ word: "dupword", translation: "同义词" });

    await ensureDistractors([findWord("dupword")!]);

    expect(findWord("dupword")!.distractors).toEqual([]);
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
    setDistractors("freshword", ["甲", "乙", "丙"]);
    genMock.mockClear();

    await ensureDistractors([findWord("freshword")!]);

    expect(genMock).not.toHaveBeenCalled();
    expect(findWord("freshword")!.distractors).toEqual(["甲", "乙", "丙"]);
  });

  it("已存的脏干扰项在读取时就地复检,不消耗 DS 调用", async () => {
    const { addWord, findWord, setDistractors } = await import(
      "../src/userdb.js"
    );
    const { ensureDistractors } = await import("../src/ensure-distractors.js");

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
    genMock.mockImplementation(async () => FULL);
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
