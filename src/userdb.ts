import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

mkdirSync(dirname(config.userDbPath), { recursive: true });

const userDb = new Database(config.userDbPath);
userDb.pragma("journal_mode = WAL");

userDb.exec(`
  CREATE TABLE IF NOT EXISTS user_words(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL UNIQUE,
    phonetic TEXT,
    translation TEXT,
    pos TEXT,
    distractors_json TEXT,
    added_at INTEGER NOT NULL,
    added_date TEXT NOT NULL,
    removed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_user_words_date ON user_words(added_date);

  CREATE TABLE IF NOT EXISTS quiz_sessions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_date TEXT NOT NULL,
    mode TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    total INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS error_bucket(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL UNIQUE,
    added_at INTEGER NOT NULL,
    correct_count INTEGER NOT NULL DEFAULT 0
  );
`);

// ---- 行类型 ----

interface UserWordRow {
  id: number;
  word: string;
  phonetic: string | null;
  translation: string | null;
  pos: string | null;
  distractors_json: string | null;
  added_at: number;
  added_date: string;
  removed_at: number | null;
}

interface ErrorRow {
  id: number;
  word: string;
  added_at: number;
  correct_count: number;
}

export interface WordInput {
  word: string;
  phonetic?: string | null;
  translation?: string | null;
  pos?: string | null;
  distractors?: string[];
}

// ---- 工具 ----

/** 服务器本地日期 YYYY-MM-DD。容器经 TZ=Asia/Shanghai 对齐用户时区。 */
function todayYmd(): string {
  const t = new Date();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${t.getFullYear()}-${m}-${d}`;
}

function wordJson(r: UserWordRow) {
  return {
    id: r.id,
    word: r.word,
    phonetic: r.phonetic,
    translation: r.translation,
    pos: r.pos,
    distractors: r.distractors_json
      ? (JSON.parse(r.distractors_json) as string[])
      : [],
    addedAt: r.added_at,
    addedDate: r.added_date,
    removedAt: r.removed_at,
  };
}

function errorJson(r: ErrorRow) {
  return {
    id: r.id,
    word: r.word,
    addedAt: r.added_at,
    correctCount: r.correct_count,
  };
}

// ---- 词本 ----

const stmtUpsertWord = userDb.prepare(`
  INSERT INTO user_words
    (word, phonetic, translation, pos, distractors_json, added_at, added_date, removed_at)
  VALUES
    (@word, @phonetic, @translation, @pos, @distractors_json, @added_at, @added_date, NULL)
  ON CONFLICT(word) DO UPDATE SET
    phonetic = excluded.phonetic,
    translation = excluded.translation,
    pos = excluded.pos,
    distractors_json = excluded.distractors_json,
    added_at = excluded.added_at,
    added_date = excluded.added_date,
    removed_at = NULL
`);
const stmtGetWord = userDb.prepare(
  `SELECT * FROM user_words WHERE word = ?`,
);
const stmtGetActiveWord = userDb.prepare(
  `SELECT * FROM user_words WHERE word = ? AND removed_at IS NULL`,
);
const stmtWordsByDate = userDb.prepare(
  `SELECT * FROM user_words
   WHERE added_date = ? AND removed_at IS NULL
   ORDER BY added_at ASC`,
);
const stmtDateCounts = userDb.prepare(
  `SELECT added_date AS d, COUNT(*) AS c
   FROM user_words WHERE removed_at IS NULL
   GROUP BY added_date`,
);
const stmtRemoveWord = userDb.prepare(
  `UPDATE user_words SET removed_at = ? WHERE id = ? AND removed_at IS NULL`,
);

/** 加入词本;词已存在则重新归桶到今天(同 ConflictAlgorithm.replace 语义)。 */
export function addWord(input: WordInput) {
  stmtUpsertWord.run({
    word: input.word,
    phonetic: input.phonetic ?? null,
    translation: input.translation ?? null,
    pos: input.pos ?? null,
    distractors_json: input.distractors
      ? JSON.stringify(input.distractors)
      : null,
    added_at: Date.now(),
    added_date: todayYmd(),
  });
  return wordJson(stmtGetWord.get(input.word) as UserWordRow);
}

export function wordsByDate(ymd: string) {
  return (stmtWordsByDate.all(ymd) as UserWordRow[]).map(wordJson);
}

/** 按词查未删除的词本条目,供错题桶抽检取词详情。 */
export function findWord(word: string) {
  const row = stmtGetActiveWord.get(word) as UserWordRow | undefined;
  return row ? wordJson(row) : null;
}

export function dateCounts(): Record<string, number> {
  const rows = stmtDateCounts.all() as { d: string; c: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.d] = r.c;
  return out;
}

export function removeWord(id: number): boolean {
  return stmtRemoveWord.run(Date.now(), id).changes > 0;
}

// ---- 错题桶 ----

const ERROR_GRADUATE = 3;

const stmtMarkError = userDb.prepare(
  `INSERT OR IGNORE INTO error_bucket (word, added_at, correct_count)
   VALUES (?, ?, 0)`,
);
const stmtGetError = userDb.prepare(
  `SELECT * FROM error_bucket WHERE word = ?`,
);
const stmtUpdateErrorCount = userDb.prepare(
  `UPDATE error_bucket SET correct_count = ? WHERE word = ?`,
);
const stmtDeleteError = userDb.prepare(
  `DELETE FROM error_bucket WHERE word = ?`,
);
const stmtErrorList = userDb.prepare(
  `SELECT * FROM error_bucket ORDER BY added_at DESC`,
);
const stmtErrorCount = userDb.prepare(
  `SELECT COUNT(*) AS c FROM error_bucket`,
);

/** 标记错题;已在桶内则不重置进度。 */
export function markError(word: string): void {
  stmtMarkError.run(word, Date.now());
}

/** 错题答对累计 +1,达 3 次自动毕业(移出错题桶)。 */
export function bumpErrorCorrect(
  word: string,
): { removed: boolean; correctCount: number } {
  const row = stmtGetError.get(word) as ErrorRow | undefined;
  if (!row) return { removed: false, correctCount: 0 };
  const next = row.correct_count + 1;
  if (next >= ERROR_GRADUATE) {
    stmtDeleteError.run(word);
    return { removed: true, correctCount: next };
  }
  stmtUpdateErrorCount.run(next, word);
  return { removed: false, correctCount: next };
}

export function errorWords() {
  return (stmtErrorList.all() as ErrorRow[]).map(errorJson);
}

export function errorCount(): number {
  return (stmtErrorCount.get() as { c: number }).c;
}

// ---- 抽检会话 ----

const stmtStartQuiz = userDb.prepare(
  `INSERT INTO quiz_sessions (target_date, mode, started_at, total, correct)
   VALUES (?, ?, ?, 0, 0)`,
);
const stmtFinishQuiz = userDb.prepare(
  `UPDATE quiz_sessions
   SET finished_at = ?, total = ?, correct = ?
   WHERE id = ?`,
);

export function startQuiz(targetDate: string, mode: string): number {
  return Number(stmtStartQuiz.run(targetDate, mode, Date.now()).lastInsertRowid);
}

export function finishQuiz(
  id: number,
  total: number,
  correct: number,
): boolean {
  return stmtFinishQuiz.run(Date.now(), total, correct, id).changes > 0;
}
