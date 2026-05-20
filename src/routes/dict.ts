import type { FastifyInstance } from "fastify";
import { queryWord } from "../db.js";

export async function registerDictRoute(app: FastifyInstance): Promise<void> {
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
