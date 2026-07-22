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
