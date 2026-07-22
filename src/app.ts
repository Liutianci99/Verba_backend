import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { requireAuth } from "./middleware/auth.js";
import { registerDictRoute } from "./routes/dict.js";
import { registerExplainRoute } from "./routes/explain.js";
import { registerTranslateRoute } from "./routes/translate.js";
import { registerAudioRoute } from "./routes/audio.js";
import { registerWordsRoutes } from "./routes/words.js";
import { registerErrorsRoutes } from "./routes/errors.js";
import { registerQuizRoutes } from "./routes/quiz.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    trustProxy: true,
    // 默认 100 会让 /audio/:word 读整句时直接 404;放宽到略高于 TTS 的 600 字上限,
    // 使长度校验落在路由内(返回 413)而不是变成匹配失败
    maxParamLength: 700,
  });

  app.register(cors, {
    origin: true, // 反射来源;API 由 Bearer 鉴权兜底,无 cookie
    methods: ["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.register(async (instance) => {
    instance.addHook("preHandler", requireAuth);
    await registerDictRoute(instance);
    await registerExplainRoute(instance);
    await registerTranslateRoute(instance);
    await registerAudioRoute(instance);
    await registerWordsRoutes(instance);
    await registerErrorsRoutes(instance);
    await registerQuizRoutes(instance);
  });

  return app;
}
