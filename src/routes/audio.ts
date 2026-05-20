import type { FastifyInstance } from "fastify";
import { fetch } from "undici";

const YOUDAO_BASE = "https://dict.youdao.com/dictvoice";

export async function registerAudioRoute(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { word: string };
    Querystring: { type?: string };
  }>("/audio/:word", async (req, reply) => {
    const word = req.params.word.trim();
    const type = req.query.type === "1" ? "1" : "2"; // 2 = US, 1 = UK
    if (!word) {
      reply.code(400);
      return { error: "word required" };
    }
    const url = `${YOUDAO_BASE}?audio=${encodeURIComponent(word)}&type=${type}`;
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      reply.code(502);
      return { error: "audio fetch failed", status: res.status };
    }
    reply.header("Content-Type", "audio/mpeg");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(res.body);
  });
}
