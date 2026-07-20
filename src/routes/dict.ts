import type { FastifyInstance } from "fastify";
import { queryWord, searchWords } from "../db.js";
import { resolveLemma } from "../lemma.js";

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

  /**
   * 查词。选中的若是屈折形(复数 / ing / 过去式等),返回的是**词根**的词条,
   * 并附上 queried 与 inflection 供客户端展示 "criteria → criterion(复数)"。
   *
   * 因此原先词典未收录某个变形时的 404,现在只要能还原到词根就能正常返回。
   */
  app.get<{ Params: { word: string } }>("/dict/:word", async (req, reply) => {
    const word = req.params.word.trim().toLowerCase();
    if (!word) {
      reply.code(400);
      return { error: "word required" };
    }
    const row = queryWord.get(word) ?? null;
    const lem = resolveLemma(word, row);

    // 词根条目优先;词根本身未收录时退回原词条目
    const primary = lem?.row ?? row;
    if (!primary) {
      reply.code(404);
      return { error: "not found" };
    }
    return {
      ...primary,
      queried: word,
      lemma: lem?.lemma ?? primary.word,
      inflection: lem?.inflection ?? null, // 已是原形则为 null
    };
  });
}
