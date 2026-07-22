import { describe, it, expect } from "vitest";
import {
  addWord,
  markError,
  bumpErrorCorrect,
  errorWords,
  errorCount,
  removeWord,
  findWord,
} from "../src/userdb.js";

/**
 * 错题桶行为。
 *
 * 间隔重复的两条硬约束:
 *   - 再次答错必须清零进度(否则刚栽过的词一次答对就毕业)
 *   - 同一天答对只计一次(否则连刷三轮可在一分钟内毕业)
 */
describe("错题桶", () => {
  it("答错入桶,进度从 0 开始", () => {
    addWord({ word: "gauge", translation: "n. 计量器" });
    markError("gauge");
    const row = errorWords().find((e) => e.word === "gauge");
    expect(row).toBeDefined();
    expect(row!.correctCount).toBe(0);
  });

  it("再次答错清零已累计的进度", () => {
    addWord({ word: "volatility", translation: "n. 波动性" });
    markError("volatility");
    bumpErrorCorrect("volatility", "2026-07-20");
    expect(
      errorWords().find((e) => e.word === "volatility")!.correctCount,
    ).toBe(1);

    markError("volatility"); // 又答错了
    expect(
      errorWords().find((e) => e.word === "volatility")!.correctCount,
    ).toBe(0);
  });

  it("同一天重复答对只累计一次", () => {
    addWord({ word: "derivative", translation: "n. 衍生物" });
    markError("derivative");

    const a = bumpErrorCorrect("derivative", "2026-07-20");
    const b = bumpErrorCorrect("derivative", "2026-07-20");
    const c = bumpErrorCorrect("derivative", "2026-07-20");

    expect(a.correctCount).toBe(1);
    expect(a.counted).toBe(true);
    expect(b.counted).toBe(false);
    expect(c.counted).toBe(false);
    expect(b.correctCount).toBe(1);
    expect(c.correctCount).toBe(1);
    expect(errorWords().some((e) => e.word === "derivative")).toBe(true);
  });

  it("三个不同日期各答对一次才毕业", () => {
    addWord({ word: "incorporating", translation: "v. 合并" });
    markError("incorporating");

    expect(bumpErrorCorrect("incorporating", "2026-07-20").removed).toBe(false);
    expect(bumpErrorCorrect("incorporating", "2026-07-21").removed).toBe(false);
    const last = bumpErrorCorrect("incorporating", "2026-07-22");

    expect(last.removed).toBe(true);
    expect(errorWords().some((e) => e.word === "incorporating")).toBe(false);
  });

  it("词本删掉的词一并出桶,不再计入数量", () => {
    const w = addWord({ word: "obsolete", translation: "adj. 废弃的" });
    markError("obsolete");
    const before = errorCount();
    expect(errorWords().some((e) => e.word === "obsolete")).toBe(true);

    removeWord(w.id);

    expect(findWord("obsolete")).toBeNull();
    expect(errorWords().some((e) => e.word === "obsolete")).toBe(false);
    expect(errorCount()).toBe(before - 1);
  });

  it("桶内词若在词本已失效,不出现在列表(存量脏数据自愈)", () => {
    // 从未进过词本的词:抽检取不到详情,列表里也不该出现
    markError("ghostword");
    expect(errorWords().some((e) => e.word === "ghostword")).toBe(false);
  });

  it("不在桶里的词答对不产生副作用", () => {
    addWord({ word: "arithmetic", translation: "n. 算术" });
    const before = errorCount();
    const r = bumpErrorCorrect("arithmetic", "2026-07-22");
    expect(r.removed).toBe(false);
    expect(r.correctCount).toBe(0);
    expect(r.counted).toBe(false);
    expect(errorCount()).toBe(before);
  });
});
