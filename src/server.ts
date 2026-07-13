import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = buildApp();

async function start(): Promise<void> {
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
