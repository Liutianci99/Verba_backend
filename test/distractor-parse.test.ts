import { describe, it, expect } from "vitest";
import { parseDistractorLines } from "../src/deepseek.js";

/**
 * 干扰项产物解析。
 *
 * 新 prompt 要求模型按 `英文单词|中文释义` 输出,取释义部分做干扰项。
 * 模型的格式服从度不是百分百,解析要容错。
 */
describe("parseDistractorLines", () => {
  it("取竖线后的释义,丢掉英文单词", () => {
    const out = parseDistractorLines(
      "gouge|凿子,挖凿\ngorge|峡谷\nliquidity|流动性",
    );
    expect(out).toEqual(["凿子,挖凿", "峡谷", "流动性"]);
  });

  it("兼容全角竖线", () => {
    expect(parseDistractorLines("gouge｜凿子\ngorge｜峡谷\ngauze｜纱布")).toEqual(
      ["凿子", "峡谷", "纱布"],
    );
  });

  it("模型漏掉竖线时整行当释义", () => {
    expect(parseDistractorLines("凿子\n峡谷\n纱布")).toEqual([
      "凿子",
      "峡谷",
      "纱布",
    ]);
  });

  it("剥掉序号和项目符号", () => {
    expect(
      parseDistractorLines("1. gouge|凿子\n2、gorge|峡谷\n- gauze|纱布"),
    ).toEqual(["凿子", "峡谷", "纱布"]);
  });

  it("释义里含竖线时全部保留", () => {
    expect(parseDistractorLines("gouge|凿子|挖凿")).toEqual(["凿子 挖凿"]);
  });

  it("忽略空行,最多取 3 个", () => {
    expect(
      parseDistractorLines("a|甲\n\nb|乙\n\nc|丙\nd|丁"),
    ).toEqual(["甲", "乙", "丙"]);
  });

  it("空输入返回空数组", () => {
    expect(parseDistractorLines("")).toEqual([]);
  });
});
