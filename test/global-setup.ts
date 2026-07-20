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
       pos TEXT, collins INTEGER, oxford INTEGER, tag TEXT, bnc INTEGER, frq INTEGER,
       exchange TEXT
     );`,
  );
  const ins = ec.prepare(
    `INSERT INTO stardict
       (word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  // 原形:自身不指向词根,exchange 里列的是它的各种变形
  ins.run(
    "run", "rʌn", "to move fast on foot",
    "vt. 经营\nvi. 跑\nn. 跑；一段连续的时期",
    "v/n", 4, 1, "gk cet4", 100, 200,
    "p:ran/i:running/d:run/3:runs/s:runs",
  );
  // 屈折形:exchange 指回词根,用于词形还原
  ins.run(
    "running", "ˈrʌnɪŋ", "the action of running",
    "n. 跑步\nadj. 连续的", "j:63/n:37", null, null, "", 3000, 4000,
    "0:run/1:i",
  );
  ins.run(
    "criteria", "kraɪˈtɪəriə", "plural of criterion",
    "n. 标准（criterion的复数）", "n:100", null, null, "", 5000, 6000,
    "0:criterion/1:s",
  );
  ins.run(
    "criterion", "kraɪˈtɪəriən", "a standard of judgement",
    "n. 标准；准则", "n:100", 3, 1, "cet6", 4000, 5000, "s:criteria",
  );
  // 词根存在但其复数未被收录 —— 用于验证词尾规则回退
  ins.run(
    "hedge", "hedʒ", "a fence formed by bushes",
    "n. 树篱\nvt. 对冲", "n/v", 3, 1, "cet6", 7000, 8000, "s:hedges/d:hedged",
  );
  ec.close();
}
