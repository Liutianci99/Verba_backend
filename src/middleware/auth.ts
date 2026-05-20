import type { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "missing bearer token" });
    return;
  }
  const token = auth.slice(7);
  if (token !== config.apiKey) {
    reply.code(401).send({ error: "invalid token" });
    return;
  }
}
