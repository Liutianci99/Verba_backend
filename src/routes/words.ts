import type { FastifyInstance } from "fastify";
import {
  addWord,
  wordsByDate,
  allWords,
  findWord,
  dateCounts,
  removeWord,
  sensesByWord,
  type SenseInput,
} from "../userdb.js";
import { ensureDistractors } from "../ensure-distractors.js";

interface WordBody {
  word?: string;
  phonetic?: string;
  translation?: string;
  pos?: string;
  distractors?: string[];
  sense?: SenseInput | null;
}

export async function registerWordsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * 词本:某日(date=YYYY-MM-DD)或全量(all=1)。
   *
   * 返回前补齐缺失的干扰项 —— 抽检是这个接口唯一的消费方,在这里自愈能同时
   * 覆盖插件与 App 两条入库路径留下的空干扰项。
   */
  app.get<{ Querystring: { date?: string; all?: string } }>(
    "/words",
    async (req, reply) => {
      const wantAll = req.query.all === "1";
      const date = req.query.date?.trim();
      if (!wantAll && !date) {
        reply.code(400);
        return { error: "date or all=1 required" };
      }
      const words = wantAll ? allWords() : wordsByDate(date!);
      return { words: await ensureDistractors(words) };
    },
  );

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
