import {
  generateDistractors,
  type DistractorCandidate,
  type DistractorKind,
} from "./deepseek.js";
import { queryWord } from "./db.js";
import { setDistractors, distractorsUpToDate } from "./userdb.js";

/** 同时在飞的 DS 请求数上限。一次全量测试可能几十个词,不能一起打出去。 */
const CONCURRENCY = 5;

interface WordLike {
  word: string;
  translation: string | null;
  distractors: string[];
}

/** 把一段中文释义拆成可比对的语义片段,并剥掉词性标记。 */
function segments(text: string): string[] {
  return text
    .replace(/\b(n|v|vt|vi|adj|adv|prep|conj|pron|art|num|int)\.\s*/gi, "")
    .split(/[;；,，、\n/|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 该词"不可用作干扰项"的语义集合。
 *
 * 光比对存的 translation 不够:插件存的是泛意,往往只有一两个词。
 * parity 存的是「同等,平价」,而 DS 给的干扰项「奇偶性,对等」同样是
 * parity 的真实词义,只是不在这个短泛意里,字符串比对抓不到。
 * ECDICT 收录了该词的全部义项,拿它做否决才堵得住。
 */
function forbiddenMeanings(word: string, translation: string): Set<string> {
  const out = new Set(segments(translation));
  const row = queryWord.get(word);
  if (row?.translation) for (const s of segments(row.translation)) out.add(s);
  return out;
}

/**
 * 清洗并按类别配额挑选干扰项。
 *
 * 剔除四类:
 * - 字符串内重复词元。DS 偶发把同一个词吐三遍(线上 parity 拿到
 *   「部分 部分 部分」)。按词元去重,「n. 把手 扣环 旋钮」这种词元
 *   各异的正常释义不受影响。
 * - 与该词任一真实义项撞车的(见 forbiddenMeanings)。DS 屡屡把正确
 *   答案原样吐回来,volatility 就拿到过「波动性」。
 * - 彼此重复的,否则选项里出现两个一样的。
 * - 空的。
 *
 * 挑选按 2 形近 + 1 同领域;某一类不够时用另一类补满,凑不齐 3 个则
 * 返回空,由调用方整组丢弃、退回跨词兜底。
 */
function pick(
  raw: DistractorCandidate[],
  word: string,
  translation: string,
): string[] {
  const forbidden = forbiddenMeanings(word, translation);
  const seen = new Set<string>();
  const byKind: Record<DistractorKind, string[]> = { 形近: [], 同领域: [] };

  for (const c of raw) {
    const tokens = c.meaning.trim().split(/\s+/).filter(Boolean);
    const text = [...new Set(tokens)].join(" ");
    if (!text || seen.has(text)) continue;
    // 整体撞车,或拆开后任一片段撞车
    if (forbidden.has(text)) continue;
    if (segments(text).some((s) => forbidden.has(s))) continue;
    seen.add(text);
    byKind[c.kind].push(text);
  }

  const out = byKind["形近"].slice(0, 2);
  out.push(...byKind["同领域"].slice(0, 1));
  // 配额不足时互相补位
  for (const extra of [...byKind["形近"].slice(2), ...byKind["同领域"].slice(1)]) {
    if (out.length >= 3) break;
    out.push(extra);
  }
  return out.length >= 3 ? out.slice(0, 3) : [];
}

/**
 * 复检已落库的干扰项。
 *
 * 与 pick 同一套剔除规则,只是输入是纯字符串、没有类别信息,因此不做
 * 配额挑选,原序保留。用于清洗规则收紧后让存量数据自愈。
 */
function revalidate(
  stored: string[],
  word: string,
  translation: string,
): string[] {
  const forbidden = forbiddenMeanings(word, translation);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of stored) {
    const tokens = item.trim().split(/\s+/).filter(Boolean);
    const text = [...new Set(tokens)].join(" ");
    if (!text || seen.has(text) || forbidden.has(text)) continue;
    if (segments(text).some((s) => forbidden.has(s))) continue;
    seen.add(text);
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
  for (const w of words) {
    if (w.distractors.length === 0) continue;

    // 旧策略的产物一律作废。它们是"同一个词的其它义项",清洗规则挑不出
    // 毛病(格式干净、彼此不重复),只能靠版本号识别。
    if (!distractorsUpToDate(w.word)) {
      w.distractors = [];
      continue;
    }

    // 就地复检当前策略的产物。纯本地操作不花 DS 调用,清洗规则收紧前
    // 落的脏数据在这里自愈。剩不足 3 个的视同缺失,交给下面重新生成。
    const cleaned = revalidate(w.distractors, w.word, (w.translation ?? "").trim());
    if (
      cleaned.length === w.distractors.length &&
      cleaned.every((v, i) => v === w.distractors[i])
    ) {
      continue; // 本来就干净,不必写库
    }
    if (cleaned.length >= 3) {
      setDistractors(w.word, cleaned);
      w.distractors = cleaned;
    } else {
      w.distractors = [];
    }
  }

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
          const got = pick(
            await generateDistractors(w.word, meaning),
            w.word,
            meaning,
          );
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
