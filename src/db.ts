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
}

export const queryWord = db.prepare<[string], WordRow>(`
  SELECT word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq
  FROM stardict
  WHERE word = ? COLLATE NOCASE
  LIMIT 1
`);
