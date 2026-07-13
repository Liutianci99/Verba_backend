import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { requireAuth } from "./middleware/auth.js";
import { registerDictRoute } from "./routes/dict.js";
import { registerExplainRoute } from "./routes/explain.js";
import { registerDistractorsRoute } from "./routes/distractors.js";
import { registerAudioRoute } from "./routes/audio.js";
import { registerWordsRoutes } from "./routes/words.js";
import { registerErrorsRoutes } from "./routes/errors.js";
import { registerQuizRoutes } from "./routes/quiz.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    trustProxy: true,
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
    await registerDistractorsRoute(instance);
    await registerAudioRoute(instance);
    await registerWordsRoutes(instance);
    await registerErrorsRoutes(instance);
    await registerQuizRoutes(instance);
  });

  return app;
}
