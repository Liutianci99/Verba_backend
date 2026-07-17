import type { FastifyInstance } from "fastify";
import { queryWord, searchWords } from "../db.js";

export async function registerDictRoute(app: FastifyInstance): Promise<void> {
  // 模糊查询(前缀匹配),须在 /dict/:word 之前——Fastify 静态路由优先,顺序其实无所谓
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    "/dict/search",
    async (req, reply) => {
      const q = (req.query.q ?? "").trim().toLowerCase();
      if (!q) {
        reply.code(400);
        return { error: "q required" };
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
      // 转义 LIKE 通配符,做前缀匹配
      const like = q.replace(/[\\%_]/g, "\\$&") + "%";
      const rows = searchWords.all(like, limit);
      return {
        matches: rows.map((r) => ({
          word: r.word,
          phonetic: r.phonetic,
          translation: r.translation,
        })),
      };
    },
  );

  app.get<{ Params: { word: string } }>("/dict/:word", async (req, reply) => {
    const word = req.params.word.trim().toLowerCase();
    if (!word) {
      reply.code(400);
      return { error: "word required" };
    }
    const row = queryWord.get(word);
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    return row;
  });
}
