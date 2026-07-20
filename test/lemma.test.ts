import { describe, it, expect } from "vitest";
import { parseExchange, resolveLemma, isInflectionOf } from "../src/lemma.js";
import { queryWord } from "../src/db.js";

const row = (w: string) => queryWord.get(w) ?? null;

describe("parseExchange", () => {
  it("解析 ECDICT 屈折字段", () => {
    const m = parseExchange("0:run/1:i");
    expect(m.get("0")).toBe("run");
    expect(m.get("1")).toBe("i");
  });

  it("空值与畸形输入返回空表,不抛", () => {
    expect(parseExchange(null).size).toBe(0);
    expect(parseExchange("").size).toBe(0);
    expect(parseExchange("garbage//:x/").size).toBe(0);
  });
});

describe("resolveLemma", () => {
  it("现在分词还原到词根", () => {
    const r = resolveLemma("running", row("running"));
    expect(r?.lemma).toBe("run");
    expect(r?.inflection).toBe("现在分词");
    expect(r?.row?.phonetic).toBe("rʌn");
  });

  it("复数还原到词根", () => {
    const r = resolveLemma("criteria", row("criteria"));
    expect(r?.lemma).toBe("criterion");
    expect(r?.inflection).toBe("复数");
  });

  it("本身是原形则返回 null", () => {
    expect(resolveLemma("run", row("run"))).toBeNull();
    expect(resolveLemma("criterion", row("criterion"))).toBeNull();
  });

  it("词典未收录该变形时走词尾规则回退", () => {
    // fixture 里没有 "hedges" 这一条,只有词根 "hedge"
    expect(row("hedges")).toBeNull();
    const r = resolveLemma("hedges", null);
    expect(r?.lemma).toBe("hedge");
    expect(r?.inflection).toBe("复数");
  });

  it("回退候选必须真实存在于词典,否则不臆造词根", () => {
    expect(resolveLemma("zzzqing", null)).toBeNull();
    expect(resolveLemma("nonexistents", null)).toBeNull();
  });

  it("空输入安全", () => {
    expect(resolveLemma("", null)).toBeNull();
    expect(resolveLemma("   ", null)).toBeNull();
  });
});

describe("isInflectionOf(交叉验证)", () => {
  it("词典证实该形式属于给定词根", () => {
    // fixture: run 的 exchange 含 i:running / p:ran / 3:runs
    expect(isInflectionOf("running", "run")).toBe("现在分词");
    expect(isInflectionOf("ran", "run")).toBe("过去式");
    expect(isInflectionOf("criteria", "criterion")).toBe("复数");
  });

  it("不属于则返回 null,LLM 的臆断不会被采纳", () => {
    expect(isInflectionOf("running", "criterion")).toBeNull();
    expect(isInflectionOf("banana", "run")).toBeNull();
  });

  it("词根不在词典中时返回 null", () => {
    expect(isInflectionOf("zzzs", "zzz")).toBeNull();
  });
});
