import type { FastifyInstance } from "fastify";
import { translateText } from "../deepseek.js";

export async function registerTranslateRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { text?: string } }>(
    "/translate",
    {
      schema: {
        body: {
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string", minLength: 1, maxLength: 1000 },
          },
        },
      },
    },
    async (req, reply) => {
      const text = req.body.text!.trim();
      try {
        const translation = await translateText(text);
        return { text, translation };
      } catch (e) {
        app.log.error(e);
        reply.code(502);
        return { error: "translate failed" };
      }
    },
  );
}
