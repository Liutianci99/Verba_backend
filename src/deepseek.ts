import { fetch } from "undici";
import { config } from "./config.js";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

interface DeepSeekResponse {
  choices?: Array<{ message?: { content?: string } }>;
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
      // v4 是推理模型,思维链计入 completion_tokens。实测最坏情况(选中屈折形、
      // prompt 带整段歧义说明)flash 用 269、pro 用 361,原来的 400 余量太薄;
      // 一旦超限就 finish_reason=length,JSON 被截断后这里抛错、路由返 502。
      max_tokens: 1500,
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

/** ECDICT 未收录时的兜底词条。见 routes/dict.ts。 */
export interface AiDefinition {
  /** 是否真实存在的英文单词/术语/缩写/专有名词 */
  isWord: boolean;
  /** isWord 为 false 时最可能的正确拼写 */
  suggestion: string | null;
  phonetic: string | null;
  translation: string | null;
  definition: string | null;
  pos: string | null;
}

/**
 * 生成一个 ECDICT 未收录词的词条。
 *
 * 关键是 isWord:ECDICT 收录 77 万词条,查不到多半是拼错了,而模型对
 * "recieve" 一样能编出一套像样的释义。所以先让它自己判定真假,判假就只取
 * 拼写建议、其余字段一概不要。
 */
export async function defineWord(word: string): Promise<AiDefinition> {
  const prompt = `英文词 "${word}" 未收录于本地词典。请判断它是否真实存在。

请只输出一个 JSON 对象,字段如下:
- isWord: 布尔值。是真实存在的英文单词/术语/缩写/专有名词则 true;是拼写错误、随机字符或根本不存在的形式则 false
- suggestion: isWord 为 false 时给出最可能的正确拼写(纯小写单词),否则 null
- phonetic: 标准 IPA 音标,含首尾斜杠,形如 "/ˌɔːθɒɡəˈnælɪti/";不确定就给 null,不要编
- translation: 中文释义,对齐词典风格如 "n. 正交性",多个义项用换行分隔
- definition: 简短的英文释义
- pos: 主要词性,只输出缩写,取值限于 n. / v. / adj. / adv. / prep. / conj. / pron. / num. / art. / int.

isWord 为 false 时,除 suggestion 外其余字段一律填 null。
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
      // 与 explainInContext 同值,理由见那里:思维链计入 completion_tokens
      max_tokens: 1500,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek API error: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as DeepSeekResponse;
  const text = data.choices?.[0]?.message?.content ?? "";
  let parsed: Partial<AiDefinition>;
  try {
    parsed = JSON.parse(text) as Partial<AiDefinition>;
  } catch {
    throw new Error(`DeepSeek returned non-JSON: ${text.slice(0, 120)}`);
  }

  if (parsed.isWord === false) {
    return {
      isWord: false,
      suggestion: cleanSuggestion(parsed.suggestion, word),
      phonetic: null,
      translation: null,
      definition: null,
      pos: null,
    };
  }

  // 没有中文释义的词条对用户毫无价值,当作兜底失败,让路由退回 404
  const translation = (parsed.translation ?? "").trim();
  if (!translation) throw new Error("DeepSeek definition missing translation");

  return {
    isWord: true,
    suggestion: null,
    phonetic: (parsed.phonetic ?? "").trim() || null,
    translation,
    definition: (parsed.definition ?? "").trim() || null,
    pos: (parsed.pos ?? "").trim() || null,
  };
}

/** 拼写建议必须是个不同于原词的纯小写词形,否则宁可不给。 */
function cleanSuggestion(raw: unknown, word: string): string | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s || s === word.toLowerCase()) return null;
  return /^[a-z]+(?:[-'][a-z]+)*$/.test(s) ? s : null;
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
      // 同上:思维链占预算。实测接近 schema 上限(447 字符)的输入耗 391,其中
      // 思维链 331 —— 译文本身很短,余量几乎全被思维链吃掉,故一并抬高。
      max_tokens: 2500,
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
