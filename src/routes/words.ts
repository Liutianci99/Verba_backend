import type { FastifyInstance } from "fastify";
import {
  addWord,
  wordsByDate,
  findWord,
  dateCounts,
  removeWord,
  sensesByWord,
  type SenseInput,
} from "../userdb.js";

interface WordBody {
  word?: string;
  phonetic?: string;
  translation?: string;
  pos?: string;
  distractors?: string[];
  sense?: SenseInput | null;
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

  // 按词查词本条目(错题桶抽检取词详情)
  app.get<{ Querystring: { word?: string } }>(
    "/words/find",
    async (req, reply) => {
      const word = req.query.word?.trim().toLowerCase();
      if (!word) {
        reply.code(400);
        return { error: "word required" };
      }
      const found = findWord(word);
      if (!found) {
        reply.code(404);
        return { error: "not found" };
      }
      return found;
    },
  );

  // 某词的全部语境释义
  app.get<{ Params: { word: string } }>("/words/:word/senses", async (req) => {
    const word = req.params.word.trim().toLowerCase();
    return { senses: sensesByWord(word) };
  });

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
      sense: req.body.sense ?? null,
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
