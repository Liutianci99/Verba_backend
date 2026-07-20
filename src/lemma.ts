import { queryWord, type WordRow } from "./db.js";

/**
 * 词形还原。
 *
 * 主依据是 ECDICT 的 exchange 字段,它已经编码了完整的屈折关系:
 *   running → "0:run/1:i"        criteria → "0:criterion/1:s"
 *   hedged  → "0:hedge/1:dp"     went     → "0:go/1:p"
 * 其中 0 是词根,1 是本词相对词根的形式代码。查表是微秒级且离线,
 * 不必为此调用 LLM。ECDICT 未收录的变形再走词尾规则回退。
 */

/** exchange 中 "1:" 的形式代码含义。 */
const FORM_LABEL: Record<string, string> = {
  p: "过去式",
  d: "过去分词",
  i: "现在分词",
  "3": "第三人称单数",
  r: "比较级",
  t: "最高级",
  s: "复数",
};

export interface Lemma {
  /** 词根 */
  lemma: string;
  /** 人类可读的形式说明,如 "复数"、"过去式/过去分词" */
  inflection: string;
  /** 词根在 ECDICT 中的行;词根本身未收录时为 null */
  row: WordRow | null;
}

/** 把 "0:run/1:i" 解析成 { "0": "run", "1": "i" }。 */
export function parseExchange(exchange: string | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!exchange) return map;
  for (const part of exchange.split("/")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key && val) map.set(key, val);
  }
  return map;
}

function labelOf(codes: string): string {
  const labels = [...codes].map((c) => FORM_LABEL[c]).filter(Boolean);
  return labels.length ? [...new Set(labels)].join("/") : "变形";
}

/**
 * 词尾规则回退:ECDICT 没收录这个变形时,剥掉常见后缀再查。
 *
 * 只在候选确实存在于词典中时才采纳,因此规则宽松一点也不会造出假词。
 */
function stripSuffix(word: string): Array<{ candidate: string; label: string }> {
  const out: Array<{ candidate: string; label: string }> = [];
  const add = (c: string, label: string): void => {
    if (c.length >= 2 && c !== word) out.push({ candidate: c, label });
  };

  if (word.endsWith("ies")) add(word.slice(0, -3) + "y", "复数");
  if (word.endsWith("es")) add(word.slice(0, -2), "复数");
  if (word.endsWith("s")) add(word.slice(0, -1), "复数");
  if (word.endsWith("ing")) {
    const base = word.slice(0, -3);
    add(base, "现在分词");
    add(base + "e", "现在分词");
    // 双写辅音:running → run
    if (base.length >= 2 && base.at(-1) === base.at(-2)) add(base.slice(0, -1), "现在分词");
  }
  if (word.endsWith("ied")) add(word.slice(0, -3) + "y", "过去式/过去分词");
  if (word.endsWith("ed")) {
    const base = word.slice(0, -2);
    add(base, "过去式/过去分词");
    add(base + "e", "过去式/过去分词");
    if (base.length >= 2 && base.at(-1) === base.at(-2)) {
      add(base.slice(0, -1), "过去式/过去分词");
    }
  }
  return out;
}

/**
 * 解析一个词的词根。已经是原形则返回 null。
 *
 * @param word 小写后的查询词
 * @param row  该词在 ECDICT 中的行(调用方通常已查过,避免重复查询)
 */
export function resolveLemma(word: string, row: WordRow | null): Lemma | null {
  const w = word.trim().toLowerCase();
  if (!w) return null;

  // 1) ECDICT exchange:权威且瞬时
  const exch = parseExchange(row?.exchange);
  const base = exch.get("0");
  if (base && base.toLowerCase() !== w) {
    return {
      lemma: base,
      inflection: labelOf(exch.get("1") ?? ""),
      row: queryWord.get(base) ?? null,
    };
  }

  // 词典里有这个词、且没有指向别的词根 → 它本身就是原形
  if (row) return null;

  // 2) 未收录:词尾规则回退,且候选必须真实存在于词典中
  for (const { candidate, label } of stripSuffix(w)) {
    const hit = queryWord.get(candidate);
    if (hit) {
      // 候选自己还指向更上层词根时继续跟一跳(如 studies → study)
      const deeper = parseExchange(hit.exchange).get("0");
      if (deeper && deeper.toLowerCase() !== candidate) {
        return {
          lemma: deeper,
          inflection: label,
          row: queryWord.get(deeper) ?? null,
        };
      }
      return { lemma: hit.word, inflection: label, row: hit };
    }
  }

  return null;
}
