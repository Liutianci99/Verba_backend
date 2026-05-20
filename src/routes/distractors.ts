import type { FastifyInstance } from "fastify";
import { generateDistractors } from "../deepseek.js";

export async function registerDistractorsRoute(
  app: FastifyInstance,
): Promise<void> {
  app.post<{ Body: { word: string; meaning: string } }>(
    "/distractors",
    {
      schema: {
        body: {
          type: "object",
          required: ["word", "meaning"],
          properties: {
            word: { type: "string", minLength: 1, maxLength: 64 },
            meaning: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const { word, meaning } = req.body;
      try {
        const distractors = await generateDistractors(word, meaning);
        if (distractors.length < 3) {
          reply.code(502);
          return { error: "llm returned fewer than 3 distractors", got: distractors };
        }
        return { distractors };
      } catch (e) {
        app.log.error(e);
        reply.code(502);
        return { error: "llm call failed" };
      }
    },
  );
}
