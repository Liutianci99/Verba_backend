import { fetch } from "undici";
import { config } from "./config.js";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

interface DeepSeekResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export type DistractorKind = "形近" | "同领域";

export interface DistractorCandidate {
  kind: DistractorKind;
  word: string;
  meaning: string;
}

/**
 * 解析干扰项产物,每行 `类别|英文单词|中文释义`。
 *
 * 抽成纯函数是为了能直接测解析,不必 mock fetch。
 * 模型的格式服从度不是百分百:兼容全角竖线、序号前缀,以及漏掉类别标签
 * (缺标签时按形近处理,它是多数派)。行内少于 2 段则整行视为释义。
 */
export function parseDistractorLines(text: string): DistractorCandidate[] {
  const out: DistractorCandidate[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[\d.、。\s\-*]+/, "").trim();
    if (!line) continue;
    const parts = line.split(/[|｜]/).map((p) => p.trim());
    let kind: DistractorKind = "形近";
    let word = "";
    let meaning = "";
    if (parts.length >= 3) {
      kind = parts[0].includes("同领域") ? "同领域" : "形近";
      word = parts[1];
      meaning = parts.slice(2).join(" ");
    } else if (parts.length === 2) {
      // 缺类别标签:第一段当单词,第二段当释义
      word = parts[0];
      meaning = parts[1];
    } else {
      meaning = parts[0];
    }
    if (meaning) out.push({ kind, word, meaning });
  }
  return out;
}

export async function generateDistractors(
  word: string,
  meaning: string,
): Promise<DistractorCandidate[]> {
  const prompt = `给定英文单词 "${word}",其正确中文释义是:"${meaning}"。
请为英语词汇选择题生成干扰项。

最重要的要求:每个干扰项必须是【另一个真实存在的英文单词】的释义,
绝对不能是 "${word}" 自身的意思 —— 包括它的其它义项、其它词性下的
意思、以及近义改写。
反例一:若 "${word}" 是 gauge,则"计量""衡量""测算"都不可用,
它们都是 gauge 本身的意思。
反例二:绝不要把上面给出的正确释义 "${meaning}" 再抄一遍当干扰项。
违反这两条会让题目出现多个正确答案,整题作废。

请给出 5 个候选,按以下顺序:
1. 形近 —— 与 "${word}" 拼写形近的单词(通常只差一两个字母)
2. 形近 —— 同上,换一个词
3. 同领域 —— 与 "${word}" 同属一个专业领域、但概念完全不同的单词
4. 形近 —— 备用
5. 同领域 —— 备用

其余要求:释义的词性尽量与正确释义一致,字数接近。

输出 5 行,每行格式为 类别|英文单词|中文释义
类别只写"形近"或"同领域"。无序号、无解释、无引号。`;

  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 400,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek API error: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as DeepSeekResponse;
  return parseDistractorLines(data.choices?.[0]?.message?.content ?? "");
}

export interface EcdictHint {
  translation: string | null;
  definition: string | null;
  pos: string | null;
}

export interface ExplainResult {
  generalMeaning: string;
  contextMeaning: string;
  pos: string;
  phrase: string;
  example: { en: string; zh: string };
  /** 词根兜底:仅在 ECDICT 还原不出时参考,见 lemma.ts */
  lemma: string;
}

export async function explainInContext(
  word: string,
  sentence: string,
  hint: EcdictHint | null,
  surface?: string,
): Promise<ExplainResult> {
  const candidates = hint?.translation
    ? `\n词典候选义项（供参考,勿照抄全部）:\n${hint.translation}`
    : "";
  // 选中的是屈折形时,把「原始形式」与「词典的还原结果」都摆出来。
  // 词典不看句子,像 leaves 这种歧义形会判错,必须让模型有机会依据句子纠正。
  const ambiguity =
    surface && surface.toLowerCase() !== word.toLowerCase()
      ? `\n注意:用户在句中选中的原始形式是 "${surface}",词典将其还原为 "${word}",` +
        `但词典不看上下文,可能判错(例如 "the leaves fell" 里 leaves 是 leaf 的复数,` +
        `而非 leave 的第三人称单数)。请依据句子判断真正的原形填入 lemma,` +
        `并让其余字段都针对你判定的这个原形。`
      : "";
  const prompt = `英文单词 "${surface ?? word}" 出现在句子:"${sentence}" 中。${candidates}${ambiguity}

请只输出一个 JSON 对象,字段如下:
- lemma: 该词的原形/词根(若本身已是原形就原样返回)。例如 running→run、criteria→criterion
- generalMeaning: 该词最广泛常用的中文意思(泛意),简短
- contextMeaning: 该词在上面这个句子里的中文意思(语境意),简短
- pos: 该词**在这个句子里**充当的词性,只输出缩写,取值限于 n. / v. / adj. / adv. / prep. / conj. / pron. / num. / art. / int.
- phrase: 用"语境意"造的一个地道英文词组/搭配
- example: 用"语境意"造的一个英文例句及其中文翻译,形如 {"en": "...", "zh": "..."}

不要输出 JSON 以外的任何文字。`;

  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 400,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek API error: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as DeepSeekResponse;
  const text = data.choices?.[0]?.message?.content ?? "";
  let parsed: Partial<ExplainResult>;
  try {
    parsed = JSON.parse(text) as Partial<ExplainResult>;
  } catch {
    throw new Error(`DeepSeek returned non-JSON: ${text.slice(0, 120)}`);
  }
  if (!parsed.generalMeaning || !parsed.contextMeaning) {
    throw new Error("DeepSeek JSON missing required fields");
  }
  return {
    generalMeaning: parsed.generalMeaning,
    contextMeaning: parsed.contextMeaning,
    pos: parsed.pos ?? "",
    phrase: parsed.phrase ?? "",
    example: {
      en: parsed.example?.en ?? "",
      zh: parsed.example?.zh ?? "",
    },
    lemma: parsed.lemma?.trim() ?? "",
  };
}

/** 整段翻译:词组/句子英译中,返回纯中文译文。 */
export async function translateText(text: string): Promise<string> {
  const prompt = `把下面的英文翻译成通顺、地道的中文。只输出译文,不要任何解释、不要引号、不要保留原文:

${text}`;

  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek API error: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as DeepSeekResponse;
  const out = (data.choices?.[0]?.message?.content ?? "").trim();
  if (!out) throw new Error("DeepSeek returned empty translation");
  return out;
}
