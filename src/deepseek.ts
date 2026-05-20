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
