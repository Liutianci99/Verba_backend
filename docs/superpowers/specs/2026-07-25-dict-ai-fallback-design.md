# 查词 DS 兜底设计

`/dict/:word` 在 ECDICT 未收录时调用 DeepSeek 生成词条，使 App 查词页不再出现「词库未收录」死路。**实施必须遵循本文档，偏离需先改文档。**

---

## 背景

`/dict/:word` 当前只查 ECDICT，经 `resolveLemma` 词形还原后仍落空即返 404。三端表现：

| 端 | 现状 | 严重度 |
|---|---|---|
| App 查词页 | 显示「词库未收录」，且 `_add()` 要求 `_def != null` → **连加入词本都做不了** | 死路 |
| 插件卡片 | `/dict` 的 404 被 `.catch(() => {})` 吞掉，`/explain` 在 `hint: null` 下照样出卡片 | 仅缺音标 |

ECDICT 收录 340 万条，其中 73 万是 `[网络]` 众包词条。**未命中远比直觉稀有，且很少是拼写错误** —— `recieve`、`definately` 这类错拼都在库里（返回的是 `[网络] 千万` 一类的低质量译文）。2026-07-25 实测 `kubernetes`、`orthogonality` 均命中，`skibidi` 才真的未收录。

因此兜底的主要受益对象是新造词、品牌名与小众术语，`suggestion` 拼写建议这条路径极少触发。

> 该结论是实装后实测得出的，与设计初期的假设相反。假设当时写的是「查不到多半是拼错了」，据此把 `isWord` 判定当作核心防线。`isWord` 仍然值得保留（实测 `zzzqwertyx` 被正确判假并给出 `qwerty`），但它防的是随机字符串，不是日常错拼。

## 目标与非目标

**目标**

- ECDICT 落空时由 DeepSeek 补出词条，两端无需改调用方式
- 拼写错误必须被识别，禁止让 DeepSeek 对假词编造释义
- 兜底结果永久缓存，同一个词只花一次钱

**非目标**

- `/dict/search` 前缀模糊查询不做兜底 → LLM 无法做 77 万词的前缀匹配
- `/explain` 的 `phonetic` 仍取自 ECDICT 行，未收录词的插件卡片**最终态依旧无音标**。补法是让 `/explain` 也读 `ai_dict` 缓存（纯缓存读，不额外花钱），属另一条链路，单独立项
- 插件代码零改动

---

## 数据流

```
GET /dict/:word
  ├─ ECDICT queryWord + resolveLemma
  │    └─ 命中 → 200 { ...row, source: "ecdict" }
  └─ 落空
       ├─ 形状不合格 → 404，禁止调用 DeepSeek
       ├─ ai_dict 缓存命中 → is_word=1 返 200；is_word=0 返 404 带 suggestion
       └─ 缓存未命中 → defineWord()
            ├─ isWord=true  → 写缓存 → 200 { ..., source: "llm" }
            ├─ isWord=false → 写缓存 → 404 { error, suggestion }
            └─ 抛错 → app.log.error → 404
```

### 形状校验只挡兜底，不挡路由

校验只决定「要不要问 DeepSeek」，ECDICT 那条路一行不动。正则复用插件 `src/lib/selection.ts` 已有的形状：

```
/^[A-Za-z]+(?:[-'][A-Za-z]+)*$/   且   length <= 64
```

**禁止**把校验提到路由入口返 400。反例：`/dict/café` 改返 400 → App 的 `lookup` 只把 404 转 null，400 走 `rethrow` → 页面从「词库未收录」退化成「查询失败: DioException...」。

该闸门同时挡掉中文、数字、URL 片段与超长串，构成成本上限的第一道锁。

### DeepSeek 报错必须返 404

这条路由的语义是「查不到」，两端对 404 均已有降级路径。**禁止**返 502。

> 2026-07 DeepSeek 下线 `deepseek-chat` 别名时，`/explain` 的 502 一路顶到插件卡片上显示「请求失败 502」。把词典未收录变成报错，等于把仅存的降级路径也拆掉。

---

## 契约

### defineWord 输出字段

| 字段 | 内容 |
|---|---|
| `isWord` | 是否真实存在的英文单词、术语、缩写或专有名词 |
| `suggestion` | `isWord=false` 时给最可能的正确拼写（纯小写单词），否则 null |
| `phonetic` | 标准 IPA，含首尾斜杠，如 `/ˌɔːθɒɡəˈnælɪti/`；不确定必须给 null |
| `translation` | 中文释义，对齐 ECDICT 风格（`n. 正交性`），多义项换行分隔 |
| `definition` | 简短英文释义 |
| `pos` | 词性缩写，取值域与 `/explain` 完全一致 |

`isWord=false` 时除 `suggestion` 外全部字段必须为 null。

请求参数：`max_tokens: 1500`、`temperature: 0.3`、`response_format: { type: "json_object" }`。

> `max_tokens` 与 `/explain` 取同值。v4 是推理模型，思维链计入 `completion_tokens`，余量太薄会触发 `finish_reason: length`，截断的 JSON 解析失败后表现为一个无从下手的 502。

### 响应体

兜底响应必须填满 `WordRow` 的形状，缺失字段显式置 null：

```
{ word, phonetic, definition, translation, pos,
  collins: null, oxford: null, tag: null, bnc: null, frq: null, exchange: null,
  queried, lemma, inflection: null, source: "llm" }
```

其中 `word`、`queried`、`lemma` 三者同为小写后的查询词本身 → ECDICT 落空即意味着 `resolveLemma` 也无结论，无词根可指，故 `inflection` 必为 null。

404 响应体必须保留 `error: "not found"` 以兼容现有两端，`suggestion` 作为增量字段附加：

```
{ error: "not found", suggestion: "receive" | null }
```

**禁止**让 DeepSeek 产出 `tag`、`collins`、`oxford`、`bnc`、`frq` → 考纲标签与词频是可查证的客观数据，编造出来无法与 ECDICT 词条区分。

`source: "ecdict" | "llm"` 为新增字段，纯增量。ECDICT 路径一并补上 `source: "ecdict"`。App 的 `WordDef.fromJson` 只读已知键，老客户端忽略该字段即可。

---

## 缓存

落 `verba_user.db`（docker volume `verba-userdata`），App 与插件共用，重部署不丢，与 `/data/audio` 发音缓存同一思路。

```sql
CREATE TABLE IF NOT EXISTS ai_dict(
  word TEXT PRIMARY KEY,
  is_word INTEGER NOT NULL,
  suggestion TEXT,
  phonetic TEXT,
  translation TEXT,
  definition TEXT,
  pos TEXT,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

- **负结果必须缓存** → 同一个拼写错误只花一次钱
- `model` 记录生成时所用模型 → 换模型后要重刷哪批缓存，得知道它是谁生成的
- 不设过期。词义不变，重刷靠手工 `DELETE`

建表写在 `src/userdb.ts` 的 `userDb.exec` 块内。新表用 `CREATE TABLE IF NOT EXISTS` 即可，无需 `addColumnIfMissing`。

### 成本上限

flash 约 0.0006 元/次。形状闸门 + 负结果缓存两道锁之后，账户 9.46 元余额对应约 1.6 万次不同的未收录词。

---

## 改动清单

### 后端（必做）

| 文件 | 改动 |
|---|---|
| `src/deepseek.ts` | 新增 `defineWord(word)` 与 `AiDefinition` 接口 |
| `src/userdb.ts` | 新增 `ai_dict` 表、`getAiDict` / `insertAiDict` 预编译语句 |
| `src/routes/dict.ts` | `/dict/:word` 加兜底分支；两条路径均补 `source` 字段 |

### App（小改）

| 文件 | 改动 |
|---|---|
| `lib/data/api_client.dart` | `WordDef` 加 `source` 字段；`lookup` 在 404 时取出 `suggestion` |
| `lib/features/search/search_page.dart` | `source == "llm"` 时显示「AI 释义」角标；「词库未收录」替换为「未收录 · 是不是要查 receive?」且可点 |

加入词本无需改动。`addToWordbook` 只用 `word` / `phonetic` / `translation` / `pos`，兜底词条全部具备。

### 插件

零改动。

---

## 测试

TDD，先红后绿。

### test/dict-ai-fallback.test.ts

`vi.mock("undici")`，断言 fetch 调用次数：

1. ECDICT 命中 → fetch 调用数 **0**
2. 未收录 + `isWord=true` → 200，`source: "llm"`，四个字段透传
3. 未收录 + `isWord=false` → 404，body 带 `suggestion`
4. 同词第二次请求 → fetch 调用数仍是 **1**
5. DeepSeek 抛错 → 404，而非 502
6. 形状不合格（中文、80 字符串）→ 404 且 fetch 调用数 **0**

第 1 与第 6 条断言的是「不花钱」，与功能同等重要。

### test/deepseek-define.test.ts

钉住厂商约束，写法对齐 `test/deepseek-model.test.ts`：

- `model` 取 `config.deepseekModel`
- `max_tokens >= 1200`
- `response_format` 为 `json_object`

---

## 参考文档

- `test/deepseek-model.test.ts` — 厂商约束回归测试的既有写法
- `src/lemma.ts` — 词形还原，兜底前的最后一道离线尝试
- `src/routes/explain.ts` — `hint: null` 分支即插件当前的隐式兜底
