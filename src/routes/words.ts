import type { FastifyInstance } from "fastify";
import { addWord, wordsByDate, dateCounts, removeWord } from "../userdb.js";

interface WordBody {
  word?: string;
  phonetic?: string;
  translation?: string;
  pos?: string;
  distractors?: string[];
}

export async function registerWordsRoutes(app: FastifyInstance): Promise<void> {
  // 某日词本
  app.get<{ Querystring: { date?: string } }>("/words", async (req, reply) => {
    const date = req.query.date?.trim();
    if (!date) {
      reply.code(400);
      return { error: "date required" };
    }
    return { words: wordsByDate(date) };
  });

  // 各日期词数,供日历视图
  app.get("/words/counts", async () => ({ counts: dateCounts() }));

  // 加入词本(词已存在则重新归桶到今天)
  app.post<{ Body: WordBody }>("/words", async (req, reply) => {
    const word = req.body.word?.trim().toLowerCase();
    if (!word) {
      reply.code(400);
      return { error: "word required" };
    }
    return addWord({
      word,
      phonetic: req.body.phonetic,
      translation: req.body.translation,
      pos: req.body.pos,
      distractors: req.body.distractors,
    });
  });

  // 软删除一个词
  app.delete<{ Params: { id: string } }>("/words/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: "invalid id" };
    }
    if (!removeWord(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    return reply.code(204).send();
  });
}
