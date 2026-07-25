import type { FastifyInstance } from "fastify";
import { queryWord, searchWords } from "../db.js";
import { resolveLemma } from "../lemma.js";
import { defineWord, type AiDefinition } from "../deepseek.js";
import { getAiDict, putAiDict, type AiDictEntry } from "../userdb.js";
import { config } from "../config.js";

/**
 * 值得送去 LLM 兜底的词形。与插件 src/lib/selection.ts 的 WORD_RE 同形。
 *
 * 这道闸门挡掉中文、数字、URL 片段与超长串,是成本上限的第一道锁。
 * 注意它**只决定要不要问 LLM**,不参与路由入参校验 —— 若提前返 400,
 * App 的 lookup 只把 404 转成 null,400 会 rethrow,
 * 页面就从「词库未收录」退化成「查询失败: DioException...」。
 */
const FALLBACK_RE = /^[a-z]+(?:[-'][a-z]+)*$/;

function worthFallback(word: string): boolean {
  return word.length <= 64 && FALLBACK_RE.test(word);
}

export async function registerDictRoute(app: FastifyInstance): Promise<void> {
  // 模糊查询(前缀匹配),须在 /dict/:word 之前——Fastify 静态路由优先,顺序其实无所谓
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    "/dict/search",
    async (req, reply) => {
      const q = (req.query.q ?? "").trim().toLowerCase();
      if (!q) {
        reply.code(400);
        return { error: "q required" };
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
      // 转义 LIKE 通配符,做前缀匹配
      const like = q.replace(/[\\%_]/g, "\\$&") + "%";
      const rows = searchWords.all(like, limit);
      return {
        matches: rows.map((r) => ({
          word: r.word,
          phonetic: r.phonetic,
          translation: r.translation,
        })),
      };
    },
  );

  /**
   * 查词。选中的若是屈折形(复数 / ing / 过去式等),返回的是**词根**的词条,
   * 并附上 queried 与 inflection 供客户端展示 "criteria → criterion(复数)"。
   *
   * 因此原先词典未收录某个变形时的 404,现在只要能还原到词根就能正常返回。
   */
  app.get<{ Params: { word: string } }>("/dict/:word", async (req, reply) => {
    const word = req.params.word.trim().toLowerCase();
    if (!word) {
      reply.code(400);
      return { error: "word required" };
    }
    const row = queryWord.get(word) ?? null;
    const lem = resolveLemma(word, row);

    // 词根条目优先;词根本身未收录时退回原词条目
    const primary = lem?.row ?? row;
    if (!primary) {
      return aiFallback(app, reply, word);
    }
    return {
      ...primary,
      queried: word,
      lemma: lem?.lemma ?? primary.word,
      inflection: lem?.inflection ?? null, // 已是原形则为 null
      source: "ecdict" as const,
    };
  });
}

/**
 * ECDICT 与词形还原都落空后的 LLM 兜底。
 *
 * LLM 报错时返 404 而非 502:这条路由的语义就是「查不到」,两端对 404 均已有
 * 降级路径(App 显示未收录、插件静默吞掉)。2026-07 DeepSeek 下线
 * deepseek-chat 别名时,/explain 的 502 一路顶到插件卡片上显示「请求失败
 * 502」—— 把词典未收录变成报错,等于把仅存的降级路径也拆掉。
 */
async function aiFallback(
  app: FastifyInstance,
  reply: { code: (n: number) => unknown },
  word: string,
): Promise<unknown> {
  const miss = (suggestion: string | null = null): unknown => {
    reply.code(404);
    // error 必须保留原值,两端已有的 404 分支依赖它;suggestion 是增量字段
    return suggestion ? { error: "not found", suggestion } : { error: "not found" };
  };

  if (!worthFallback(word)) return miss();

  let entry: AiDictEntry | null = getAiDict(word);
  if (!entry) {
    let fresh: AiDefinition;
    try {
      fresh = await defineWord(word);
    } catch (e) {
      app.log.error(e);
      return miss();
    }
    putAiDict(word, fresh, config.deepseekModel);
    entry = fresh;
  }

  if (!entry.isWord) return miss(entry.suggestion);

  return {
    word,
    phonetic: entry.phonetic,
    definition: entry.definition,
    translation: entry.translation,
    pos: entry.pos,
    // 考纲标签与词频是可查证的客观数据,编造出来就无法与 ECDICT 词条区分
    collins: null,
    oxford: null,
    tag: null,
    bnc: null,
    frq: null,
    exchange: null,
    queried: word,
    // ECDICT 落空即意味着 resolveLemma 也无结论,无词根可指
    lemma: word,
    inflection: null,
    source: "llm" as const,
  };
}
