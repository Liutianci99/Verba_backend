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
 * 清洗 DS 产物。
 *
 * 三类脏数据:
 * - 字符串内重复词元。DeepSeek 偶发把同一个词吐三遍(线上 parity 拿到
 *   「部分 部分 部分」)。按词元去重,「n. 把手 扣环 旋钮」这种词元各异的
 *   正常释义不受影响。
 * - 干扰项彼此重复,选项里会出现两个一样的。
 * - 干扰项与正确答案相同,题目会出现两个正确选项。比较口径对齐客户端
 *   (quiz_page 取 translation 的第一个分号段作为正确答案)。
 */
function clean(raw: string[], meaning: string): string[] {
  const answer = meaning.split(";")[0].trim();
  const out: string[] = [];
  for (const item of raw) {
    const tokens = item.trim().split(/\s+/).filter(Boolean);
    const text = [...new Set(tokens)].join(" ");
    if (!text || text === answer || out.includes(text)) continue;
    out.push(text);
  }
  return out;
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
          const meaning = w.translation!.trim();
          const got = clean(await generateDistractors(w.word, meaning), meaning);
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
