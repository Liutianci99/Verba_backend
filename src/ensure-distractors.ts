import { generateDistractors } from "./deepseek.js";
import { setDistractors } from "./userdb.js";

/** 同时在飞的 DS 请求数上限。一次全量测试可能几十个词,不能一起打出去。 */
const CONCURRENCY = 5;

interface WordLike {
  word: string;
  translation: string | null;
  distractors: string[];
}

/**
 * 补齐缺失的干扰项并落库。
 *
 * 干扰项本该在入库时生成,但划词插件那条路径没有接(SaveWordPayload 里没有这个
 * 字段),导致插件存的词全部为空,抽检时退化成"拿其它词的释义当选项"。
 *
 * 选择读时补而非改两条入库路径:存量词第一次被抽检到就自动补齐,不需要回填脚本,
 * 且以后再多一个客户端也不会漏。
 *
 * DS 失败保持为空 —— 客户端仍有跨词兜底,不能因为生成不出来就让抽检开不了。
 */
export async function ensureDistractors<T extends WordLike>(
  words: T[],
): Promise<T[]> {
  const pending = words.filter(
    (w) => w.distractors.length === 0 && (w.translation ?? "").trim() !== "",
  );
  if (pending.length === 0) return words;

  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (w) => {
        try {
          const got = await generateDistractors(w.word, w.translation!.trim());
          if (got.length < 3) return;
          setDistractors(w.word, got);
          w.distractors = got;
        } catch {
          // 保持为空,下次读取再试
        }
      }),
    );
  }
  return words;
}
