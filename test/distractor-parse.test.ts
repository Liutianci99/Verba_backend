import { describe, it, expect } from "vitest";
import { parseDistractorLines } from "../src/deepseek.js";

/**
 * 干扰项产物解析。
 *
 * prompt 要求模型按 `类别|英文单词|中文释义` 输出 5 行。
 * 模型的格式服从度不是百分百,解析要容错。
 */
describe("parseDistractorLines", () => {
  it("解析出类别、单词、释义三段", () => {
    const out = parseDistractorLines(
      "形近|gouge|凿子\n形近|gauze|纱布\n同领域|caliper|卡尺",
    );
    expect(out).toEqual([
      { kind: "形近", word: "gouge", meaning: "凿子" },
      { kind: "形近", word: "gauze", meaning: "纱布" },
      { kind: "同领域", word: "caliper", meaning: "卡尺" },
    ]);
  });

  it("兼容全角竖线", () => {
    expect(parseDistractorLines("形近｜gouge｜凿子")).toEqual([
      { kind: "形近", word: "gouge", meaning: "凿子" },
    ]);
  });

  it("剥掉序号和项目符号", () => {
    const out = parseDistractorLines(
      "1. 形近|gouge|凿子\n2、同领域|caliper|卡尺\n- 形近|gauze|纱布",
    );
    expect(out.map((c) => c.meaning)).toEqual(["凿子", "卡尺", "纱布"]);
    expect(out.map((c) => c.kind)).toEqual(["形近", "同领域", "形近"]);
  });

  it("缺类别标签时按形近处理,两段分别当单词和释义", () => {
    expect(parseDistractorLines("gouge|凿子")).toEqual([
      { kind: "形近", word: "gouge", meaning: "凿子" },
    ]);
  });

  it("只有一段时整行当释义", () => {
    expect(parseDistractorLines("凿子")).toEqual([
      { kind: "形近", word: "", meaning: "凿子" },
    ]);
  });

  it("释义里含竖线时全部保留", () => {
    expect(parseDistractorLines("形近|gouge|凿子|挖凿")).toEqual([
      { kind: "形近", word: "gouge", meaning: "凿子 挖凿" },
    ]);
  });

  it("忽略空行,5 行全部返回(挑选交给上层)", () => {
    const out = parseDistractorLines(
      "形近|a|甲\n\n形近|b|乙\n\n同领域|c|丙\n形近|d|丁\n同领域|e|戊",
    );
    expect(out).toHaveLength(5);
  });

  it("空输入返回空数组", () => {
    expect(parseDistractorLines("")).toEqual([]);
  });
});
