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
    correct_count INTEGER NOT NULL DEFAULT 0,
    last_correct_date TEXT
  );

  CREATE TABLE IF NOT EXISTS word_senses(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    context_meaning TEXT,
    context_sentence TEXT,
    phrase TEXT,
    example_en TEXT,
    example_zh TEXT,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_word_senses_word ON word_senses(word);
`);

/**
 * 补列迁移。
 *
 * 上面的 CREATE TABLE IF NOT EXISTS 对已存在的表是空操作,新增字段不会补进
 * 老库。生产库(143 的 verba-userdata 卷)是持续使用的,只能靠 ALTER 补。
 */
function addColumnIfMissing(table: string, column: string, decl: string): void {
  const cols = userDb
    .prepare(`PRAGMA table_info(${table})`)
    .all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    userDb.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

addColumnIfMissing("error_bucket", "last_correct_date", "TEXT");
addColumnIfMissing("user_words", "distractors_ver", "INTEGER NOT NULL DEFAULT 0");

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
  last_correct_date: string | null;
}

interface SenseRow {
  id: number;
  word: string;
  context_meaning: string | null;
  context_sentence: string | null;
  phrase: string | null;
  example_en: string | null;
  example_zh: string | null;
  added_at: number;
}

export interface SenseInput {
  contextMeaning?: string | null;
  contextSentence?: string | null;
  phrase?: string | null;
  exampleEn?: string | null;
  exampleZh?: string | null;
}

export interface WordInput {
  word: string;
  phonetic?: string | null;
  translation?: string | null;
  pos?: string | null;
  distractors?: string[];
  sense?: SenseInput | null;
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
    lastCorrectDate: r.last_correct_date,
  };
}

function senseJson(r: SenseRow) {
  return {
    id: r.id,
    word: r.word,
    contextMeaning: r.context_meaning,
    contextSentence: r.context_sentence,
    phrase: r.phrase,
    exampleEn: r.example_en,
    exampleZh: r.example_zh,
    addedAt: r.added_at,
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
const stmtAllWords = userDb.prepare(
  `SELECT * FROM user_words
   WHERE removed_at IS NULL
   ORDER BY added_at ASC`,
);
const stmtSetDistractors = userDb.prepare(
  `UPDATE user_words SET distractors_json = ?, distractors_ver = ? WHERE word = ?`,
);
const stmtGetDistractorsVer = userDb.prepare(
  `SELECT distractors_ver AS v FROM user_words WHERE word = ?`,
);
const stmtDateCounts = userDb.prepare(
  `SELECT added_date AS d, COUNT(*) AS c
   FROM user_words WHERE removed_at IS NULL
   GROUP BY added_date`,
);
const stmtRemoveWord = userDb.prepare(
  `UPDATE user_words SET removed_at = ? WHERE id = ? AND removed_at IS NULL`,
);
const stmtInsertSense = userDb.prepare(`
  INSERT INTO word_senses
    (word, context_meaning, context_sentence, phrase, example_en, example_zh, added_at)
  VALUES
    (@word, @context_meaning, @context_sentence, @phrase, @example_en, @example_zh, @added_at)
`);
const stmtSensesByWord = userDb.prepare(
  `SELECT * FROM word_senses WHERE word = ? ORDER BY added_at ASC, id ASC`,
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
  if (input.sense) {
    stmtInsertSense.run({
      word: input.word,
      context_meaning: input.sense.contextMeaning ?? null,
      context_sentence: input.sense.contextSentence ?? null,
      phrase: input.sense.phrase ?? null,
      example_en: input.sense.exampleEn ?? null,
      example_zh: input.sense.exampleZh ?? null,
      added_at: Date.now(),
    });
  }
  return wordJson(stmtGetWord.get(input.word) as UserWordRow);
}

/** 某词的全部语境释义,按加入时间升序。 */
export function sensesByWord(word: string) {
  return (stmtSensesByWord.all(word) as SenseRow[]).map(senseJson);
}

export function wordsByDate(ymd: string) {
  return (stmtWordsByDate.all(ymd) as UserWordRow[]).map(wordJson);
}

/** 全部未删除的词,供「全量测试」。 */
export function allWords() {
  return (stmtAllWords.all() as UserWordRow[]).map(wordJson);
}

/**
 * 干扰项生成策略的版本号。
 *
 * 改了 prompt 或清洗规则就 +1,全库存量数据会在下次读取时自动重新生成
 * (见 ensureDistractors)。比一次性清空好在幂等:不会每次部署重刷一遍。
 *
 * 1 → 初版,让 DS 直接产出"易混淆的错误释义"。事后发现它拿的是同一个词的
 *     其它义项(gauge 配 计量/衡量/测算),题目因此有多个正确答案。
 * 2 → 改为取【别的单词】的释义:2 个拼写形近 + 1 个同领域不同概念。
 *     上线后发现两个漏洞:DS 常把正确答案原样吐回来,剔除后不足 3 个导致
 *     整组丢弃(volatility/derivative/excessive 全空);以及撞上该词在
 *     ECDICT 里的其它义项时抓不到(parity 拿到"奇偶性")。
 * 3 → 改要 5 个带类别标签的候选留出余量,并用 ECDICT 全义项做否决校验。
 */
export const DISTRACTORS_VER = 3;

/** 回填干扰项(读时自愈,见 ensureDistractors)。 */
export function setDistractors(word: string, distractors: string[]): void {
  stmtSetDistractors.run(JSON.stringify(distractors), DISTRACTORS_VER, word);
}

/** 该词的干扰项是否由当前策略生成。存量数据为 0,一律落后。 */
export function distractorsUpToDate(word: string): boolean {
  const row = stmtGetDistractorsVer.get(word) as { v: number } | undefined;
  return (row?.v ?? 0) >= DISTRACTORS_VER;
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

/** 从词本移除;一并出错题桶,避免留下永远考不到的孤儿。 */
export function removeWord(id: number): boolean {
  const removed = stmtRemoveWord.run(Date.now(), id).changes > 0;
  if (removed) stmtDeleteErrorByWordId.run(id);
  return removed;
}

// ---- 错题桶 ----

/** 需要在 N 个不同日期各答对一次才移出错题桶。 */
const ERROR_GRADUATE = 3;

/**
 * 标记错题。
 *
 * 已在桶内的词会被清零重来:刚答错的词不该保留既往进度,否则一次答对就毕业。
 * added_at 保持首次入桶时间不变,用于呈现"这个词纠缠了多久"。
 */
const stmtMarkError = userDb.prepare(
  `INSERT INTO error_bucket (word, added_at, correct_count, last_correct_date)
   VALUES (?, ?, 0, NULL)
   ON CONFLICT(word) DO UPDATE SET
     correct_count = 0,
     last_correct_date = NULL`,
);
const stmtGetError = userDb.prepare(
  `SELECT * FROM error_bucket WHERE word = ?`,
);
const stmtUpdateErrorProgress = userDb.prepare(
  `UPDATE error_bucket SET correct_count = ?, last_correct_date = ? WHERE word = ?`,
);
const stmtDeleteError = userDb.prepare(
  `DELETE FROM error_bucket WHERE word = ?`,
);
const stmtDeleteErrorByWordId = userDb.prepare(
  `DELETE FROM error_bucket
   WHERE word = (SELECT word FROM user_words WHERE id = ?)`,
);

/**
 * 列表/计数只认词本里仍然有效的词。
 *
 * 抽检取详情走 findWord(removed_at IS NULL),取不到的词会被客户端静默跳过。
 * 若这里不同口径过滤,就会出现"角标显示 N 个,实际只考得出 M 道"的对不上,
 * 且存量脏数据无法自愈。
 */
const ERROR_ACTIVE_FROM = `
  FROM error_bucket e
  JOIN user_words u ON u.word = e.word AND u.removed_at IS NULL
`;
const stmtErrorList = userDb.prepare(
  `SELECT e.* ${ERROR_ACTIVE_FROM} ORDER BY e.added_at DESC`,
);
const stmtErrorCount = userDb.prepare(
  `SELECT COUNT(*) AS c ${ERROR_ACTIVE_FROM}`,
);

/** 标记错题;已在桶内则清零进度重新计起。 */
export function markError(word: string): void {
  stmtMarkError.run(word, Date.now());
}

/**
 * 错题答对累计 +1,在 ERROR_GRADUATE 个不同日期各答对一次后毕业。
 *
 * 同一天内重复答对不计入 —— 间隔重复的价值在于跨天的遗忘曲线,连刷三轮
 * 只能证明短期记忆。counted 告诉调用方这次是否真的推进了进度。
 */
export function bumpErrorCorrect(
  word: string,
  today: string = todayYmd(),
): { removed: boolean; correctCount: number; counted: boolean } {
  const row = stmtGetError.get(word) as ErrorRow | undefined;
  if (!row) return { removed: false, correctCount: 0, counted: false };
  if (row.last_correct_date === today) {
    return { removed: false, correctCount: row.correct_count, counted: false };
  }
  const next = row.correct_count + 1;
  if (next >= ERROR_GRADUATE) {
    stmtDeleteError.run(word);
    return { removed: true, correctCount: next, counted: true };
  }
  stmtUpdateErrorProgress.run(next, today, word);
  return { removed: false, correctCount: next, counted: true };
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
