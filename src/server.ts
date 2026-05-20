import Fastify from "fastify";
import { config } from "./config.js";
import { requireAuth } from "./middleware/auth.js";
import { registerDictRoute } from "./routes/dict.js";
import { registerDistractorsRoute } from "./routes/distractors.js";
import { registerAudioRoute } from "./routes/audio.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
  trustProxy: true,
});

app.get("/health", async () => ({ status: "ok" }));

app.register(async (instance) => {
  instance.addHook("preHandler", requireAuth);
  await registerDictRoute(instance);
  await registerDistractorsRoute(instance);
  await registerAudioRoute(instance);
});

async function start(): Promise<void> {
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
