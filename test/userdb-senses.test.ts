import { describe, it, expect } from "vitest";
import { addWord, sensesByWord } from "../src/userdb.js";

describe("word_senses 一词多义", () => {
  it("带 sense 的 addWord 会追加一条 sense", () => {
    addWord({
      word: "context",
      translation: "上下文",
      sense: {
        contextMeaning: "语境；情境",
        contextSentence: "in this context",
        phrase: "in the context of",
        exampleEn: "It makes sense in this context.",
        exampleZh: "在这个语境下说得通。",
      },
    });
    const senses = sensesByWord("context");
    expect(senses).toHaveLength(1);
    expect(senses[0].contextMeaning).toBe("语境；情境");
    expect(senses[0].phrase).toBe("in the context of");
  });

  it("同词两次不同语境 → 一词一行 user_words,但两条 sense", () => {
    addWord({ word: "spell", translation: "拼写", sense: { contextMeaning: "拼写" } });
    addWord({ word: "spell", translation: "拼写", sense: { contextMeaning: "一段时间" } });
    const senses = sensesByWord("spell");
    expect(senses).toHaveLength(2);
    expect(senses.map((s) => s.contextMeaning)).toEqual(["拼写", "一段时间"]);
  });

  it("不带 sense 的 addWord 不写 sense（Flutter 老路径）", () => {
    addWord({ word: "plain", translation: "平原" });
    expect(sensesByWord("plain")).toHaveLength(0);
  });
});
