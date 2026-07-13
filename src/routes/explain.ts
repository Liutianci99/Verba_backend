import type { FastifyInstance } from "fastify";
import { queryWord } from "../db.js";
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
      const word = req.body.word!.trim().toLowerCase();
      const sentence = req.body.sentence!.trim();
      const row = queryWord.get(word) ?? null;
      try {
        const r = await explainInContext(
          word,
          sentence,
          row ? { translation: row.translation, definition: row.definition, pos: row.pos } : null,
        );
        return {
          word,
          phonetic: row?.phonetic ?? null,
          pos: r.pos,
          generalMeaning: r.generalMeaning,
          contextMeaning: r.contextMeaning,
          phrase: r.phrase,
          example: r.example,
          ecdict: row,
        };
      } catch (e) {
        app.log.error(e);
        reply.code(502);
        return { error: "explain failed" };
      }
    },
  );
}
