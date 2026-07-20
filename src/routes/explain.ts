import type { FastifyInstance } from "fastify";
import { queryWord } from "../db.js";
import { resolveLemma } from "../lemma.js";
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
        );

        // ECDICT 还原不出时(生僻变形),采纳 LLM 给的词根兜底。
        // LLM 字段一律当作可能缺失来处理
        const llmLemma = (r.lemma ?? "").trim().toLowerCase();
        const useLlmLemma =
          !lem && llmLemma && llmLemma !== queried && /^[a-z][a-z'-]*$/.test(llmLemma);
        const finalWord = useLlmLemma ? llmLemma : word;
        const finalRow = useLlmLemma ? (queryWord.get(llmLemma) ?? row) : row;

        return {
          word: finalWord,
          queried,
          inflection: lem?.inflection ?? (useLlmLemma ? "变形" : null),
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
