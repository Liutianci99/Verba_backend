import type { FastifyInstance } from "fastify";
import { queryWord } from "../db.js";
import { resolveLemma, isInflectionOf } from "../lemma.js";
import { explainInContext } from "../deepseek.js";

export async function registerExplainRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { word?: string; sentence?: string } }>(
    "/explain",
    {
      schema: {
        body: {
          type: "object",
          required: ["word", "sentence"],
          properties: {
            word: { type: "string", minLength: 1, maxLength: 64 },
            sentence: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    async (req, reply) => {
      const queried = req.body.word!.trim().toLowerCase();
      const sentence = req.body.sentence!.trim();

      // 先做词形还原:解释与入库都以词根为准,语境判断仍用原句
      const queriedRow = queryWord.get(queried) ?? null;
      const lem = resolveLemma(queried, queriedRow);
      const word = lem?.lemma.toLowerCase() ?? queried;
      const row = lem?.row ?? queriedRow;

      try {
        const r = await explainInContext(
          word,
          sentence,
          row ? { translation: row.translation, definition: row.definition, pos: row.pos } : null,
          queried, // 让模型看得到原始形式,才可能纠正词典的歧义误判
        );

        // LLM 字段一律当作可能缺失/畸形来处理
        const llmLemma = (r.lemma ?? "").trim().toLowerCase();
        const llmUsable =
          !!llmLemma && llmLemma !== queried && /^[a-z][a-z'-]*$/.test(llmLemma);

        let finalWord = word;
        let finalRow = row;
        let inflection = lem?.inflection ?? null;

        if (llmUsable && llmLemma !== word) {
          // 采纳 LLM 词根的两种情形,都要求它是词典里的真词,避免臆造:
          // 1) 词典已有结论 → 必须由词典自己证实 queried 是 llmLemma 的屈折形
          //    (leaves 在 "the leaves fell" 里应是 leaf 的复数,而非 leave 的三单)
          // 2) 词典毫无结论 → 只要 llmLemma 确实收录就采纳
          const verified = isInflectionOf(queried, llmLemma);
          const llmRow = queryWord.get(llmLemma) ?? null;
          if (verified) {
            finalWord = llmLemma;
            finalRow = llmRow ?? row;
            inflection = verified;
          } else if (!lem && llmRow) {
            finalWord = llmLemma;
            finalRow = llmRow;
            inflection = "变形";
          }
        }

        return {
          word: finalWord,
          queried,
          inflection,
          phonetic: finalRow?.phonetic ?? null,
          pos: r.pos,
          generalMeaning: r.generalMeaning,
          contextMeaning: r.contextMeaning,
          phrase: r.phrase,
          example: r.example,
          ecdict: finalRow,
        };
      } catch (e) {
        app.log.error(e);
        reply.code(502);
        return { error: "explain failed" };
      }
    },
  );
}
