import type { FastifyInstance } from "fastify";
import { markError, bumpErrorCorrect, errorWords, errorCount } from "../userdb.js";

export async function registerErrorsRoutes(app: FastifyInstance): Promise<void> {
  // 错题桶列表
  app.get("/errors", async () => ({ errors: errorWords() }));

  // 错题桶词数
  app.get("/errors/count", async () => ({ count: errorCount() }));

  // 标记错题(已在桶内则不重置进度)
  app.post<{ Body: { word?: string } }>("/errors", async (req, reply) => {
    const word = req.body.word?.trim().toLowerCase();
    if (!word) {
      reply.code(400);
      return { error: "word required" };
    }
    markError(word);
    return reply.code(204).send();
  });

  // 错题答对 +1,达 3 次自动移出
  app.post<{ Params: { word: string } }>(
    "/errors/:word/correct",
    async (req) => {
      const word = req.params.word.trim().toLowerCase();
      return bumpErrorCorrect(word);
    },
  );
}
