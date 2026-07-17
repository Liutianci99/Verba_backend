import { fetch } from "undici";
import { config } from "./config.js";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

interface DeepSeekResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function generateDistractors(
  word: string,
  meaning: string,
): Promise<string[]> {
  const prompt = `给定英文单词 "${word}",其正确中文释义是:"${meaning}"。
请生成 3 个易混淆但错误的中文释义,用于英语词汇选择题的干扰项。要求:
1. 不能与正确释义有重叠语义
2. 词性尽量与正确释义一致
3. 字数与正确释义接近
4. 优先选用中级英语学习者容易混淆的词义

只输出 3 行,每行一个干扰项,无序号、无解释、无引号、无标点结尾。`;

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
      max_tokens: 200,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek API error: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as DeepSeekResponse;
  const text = data.choices?.[0]?.message?.content ?? "";
  return text
    .split("\n")
    .map((l) => l.replace(/^[\d.、。\s\-*]+/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
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
}

export async function explainInContext(
  word: string,
  sentence: string,
  hint: EcdictHint | null,
): Promise<ExplainResult> {
  const candidates = hint?.translation
    ? `\n词典候选义项（供参考,勿照抄全部）:\n${hint.translation}`
    : "";
  const prompt = `英文单词 "${word}" 出现在句子:"${sentence}" 中。${candidates}

请只输出一个 JSON 对象,字段如下:
- generalMeaning: 该词最广泛常用的中文意思(泛意),简短
- contextMeaning: 该词在上面这个句子里的中文意思(语境意),简短
- pos: 语境意对应的词性缩写,如 n. / v. / adj.
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
