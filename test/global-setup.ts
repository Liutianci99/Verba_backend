import Database from "better-sqlite3";
import { rmSync, mkdirSync } from "node:fs";

export default function setup(): void {
  mkdirSync("./.tmp-test", { recursive: true });
  rmSync("./.tmp-test/ecdict.db", { force: true });
  rmSync("./.tmp-test/user.db", { force: true });

  const ec = new Database("./.tmp-test/ecdict.db");
  ec.exec(
    `CREATE TABLE stardict(
       word TEXT, phonetic TEXT, definition TEXT, translation TEXT,
       pos TEXT, collins INTEGER, oxford INTEGER, tag TEXT, bnc INTEGER, frq INTEGER
     );`,
  );
  ec.prepare(
    `INSERT INTO stardict
       (word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "run", "rʌn", "to move fast on foot",
    "vt. 经营\nvi. 跑\nn. 跑；一段连续的时期",
    "v/n", 4, 1, "gk cet4", 100, 200,
  );
  ec.close();
}
