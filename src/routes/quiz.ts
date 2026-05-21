import type { FastifyInstance } from "fastify";
import { startQuiz, finishQuiz } from "../userdb.js";

export async function registerQuizRoutes(app: FastifyInstance): Promise<void> {
  // 开始一次抽检
  app.post<{ Body: { targetDate?: string; mode?: string } }>(
    "/quiz",
    async (req, reply) => {
      const targetDate = req.body.targetDate?.trim();
      const mode = req.body.mode?.trim();
      if (!targetDate || !mode) {
        reply.code(400);
        return { error: "targetDate and mode required" };
      }
      return { id: startQuiz(targetDate, mode) };
    },
  );

  // 结束抽检,写入成绩
  app.patch<{ Params: { id: string }; Body: { total?: number; correct?: number } }>(
    "/quiz/:id",
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        reply.code(400);
        return { error: "invalid id" };
      }
      if (!finishQuiz(id, req.body.total ?? 0, req.body.correct ?? 0)) {
        reply.code(404);
        return { error: "not found" };
      }
      return reply.code(204).send();
    },
  );
}
