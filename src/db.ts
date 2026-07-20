import Database from "better-sqlite3";
import { config } from "./config.js";

export const db = new Database(config.ecdictPath, {
  readonly: true,
  fileMustExist: true,
});

db.pragma("journal_mode = OFF");
db.pragma("synchronous = OFF");
db.pragma("temp_store = MEMORY");

export interface WordRow {
  word: string;
  phonetic: string | null;
  definition: string | null;
  translation: string | null;
  pos: string | null;
  collins: number | null;
  oxford: number | null;
  tag: string | null;
  bnc: number | null;
  frq: number | null;
  /** 屈折关系,形如 "0:run/1:i";词形还原据此进行,见 lemma.ts */
  exchange: string | null;
}

export const queryWord = db.prepare<[string], WordRow>(`
  SELECT word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange
  FROM stardict
  WHERE word = ? COLLATE NOCASE
  LIMIT 1
`);

/** 前缀模糊查询:按词频(frq 小=常用)优先、短词优先。参数:LIKE 模式、上限。 */
export const searchWords = db.prepare<[string, number], WordRow>(`
  SELECT word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange
  FROM stardict
  WHERE word LIKE ? ESCAPE '\\'
  ORDER BY
    CASE WHEN frq > 0 THEN frq ELSE 1000000 END ASC,
    length(word) ASC
  LIMIT ?
`);
