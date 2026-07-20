import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getAudio, US_VOICE, UK_VOICE } from "../tts.js";

const MAX_TEXT = 600;

export async function registerAudioRoute(app: FastifyInstance): Promise<void> {
  /**
   * 发音:Kokoro 合成 + 服务端永久缓存。
   *
   * 划词插件与 Verba App 共用此接口,因此也共用同一份缓存 —— 任一端播过的词,
   * 另一端首次点击即为缓存命中。
   *
   * type: 2/缺省 = 美音,1 = 英音;voice 可显式覆盖音色。
   */
  app.get<{
    Params: { word: string };
    Querystring: { type?: string; voice?: string };
  }>("/audio/:word", async (req, reply) => {
    const text = req.params.word.trim();
    if (!text) {
      reply.code(400);
      return { error: "word required" };
    }
    if (text.length > MAX_TEXT) {
      reply.code(413);
      return { error: `text too long (max ${MAX_TEXT})` };
    }

    const voice = req.query.voice?.trim() || (req.query.type === "1" ? UK_VOICE : US_VOICE);

    let buf: Buffer;
    let cached: boolean;
    try {
      ({ buf, cached } = await getAudio(text, voice));
    } catch (e) {
      req.log.error({ err: e, text, voice }, "tts failed");
      reply.code(502);
      return { error: "audio synthesis failed" };
    }

    const etag = `"${createHash("sha1").update(buf).digest("hex").slice(0, 16)}"`;
    if (req.headers["if-none-match"] === etag) {
      reply.code(304);
      return null;
    }

    reply.header("Content-Type", "audio/mpeg");
    reply.header("Content-Length", String(buf.length));
    // 读音不变,可长期缓存;immutable 让客户端连再验证都省掉
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("ETag", etag);
    reply.header("X-Cache", cached ? "HIT" : "MISS");
    reply.header("X-Voice", voice);
    return reply.send(buf);
  });
}
