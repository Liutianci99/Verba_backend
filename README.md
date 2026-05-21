# Verba Backend

Verba 背词工具的服务端。代理 ECDICT 词库查询、DeepSeek 干扰项生成、有道美音音频,并持久化用户数据(词本、抽检、错题桶)。

## 技术栈

- Node.js 22 + Fastify 5 + TypeScript
- better-sqlite3 + ECDICT 全量 77 万词(构建时下载,内嵌镜像,只读)
- 用户数据库:独立可写 SQLite,落在 docker volume 上
- DeepSeek API 预生成易混淆中文释义

## 数据模型

- 只读 ECDICT 词库与可写用户库**两个独立 SQLite 文件**:ECDICT 烤进镜像,用户库挂持久化卷,部署更新不丢数据
- 单用户模型:以 API key 为身份,无需账号登录
- 用户数据为唯一数据源,前端不再本地存主数据

## 接口

所有业务接口需 Bearer 鉴权:`Authorization: Bearer <API_KEY>`。`/health` 不需要。

词典与音频:

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查(免鉴权) |
| GET | `/dict/:word` | 查词,返回 ECDICT 行 |
| POST | `/distractors` | body `{word, meaning}`,返回 3 个易混淆中文释义 |
| GET | `/audio/:word?type=2` | 美音音频流(type=1 英音、2 美音) |

用户数据:

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/words?date=YYYY-MM-DD` | 某日词本 |
| GET | `/words/counts` | 各日期词数(日历视图) |
| GET | `/words/find?word=` | 按词查词本条目(错题桶抽检) |
| POST | `/words` | body `{word, phonetic?, translation?, pos?, distractors?}`,加入词本 |
| DELETE | `/words/:id` | 软删除一个词 |
| GET | `/errors` | 错题桶列表 |
| GET | `/errors/count` | 错题桶词数 |
| POST | `/errors` | body `{word}`,标记错题 |
| POST | `/errors/:word/correct` | 错题答对 +1,达 3 次自动移出 |
| POST | `/quiz` | body `{targetDate, mode}`,开始抽检,返回 `{id}` |
| PATCH | `/quiz/:id` | body `{total, correct}`,结束抽检写入成绩 |

## 进度

- [x] Fastify + better-sqlite3 + TypeScript 工程脚手架
- [x] 接口:`/dict` `/distractors` `/audio` + Bearer 鉴权 + `/health`
- [x] Docker 多阶段构建,构建时内嵌 ECDICT 77 万词
- [x] CI/CD:GHA 构建推 GHCR + 服务器侧拉取部署
- [x] 首次部署上线(`121.5.23.149:8080`)
- [x] 三接口联调验证(`/dict` `/distractors` `/audio` 全部 200)
- [x] 用户数据接口:词本 / 错题桶 / 抽检会话,持久化卷
- [ ] 前端切换为后端唯一数据源

## 本地运行

```bash
npm install
cp .env.example .env   # 填入 API_KEY 与 DEEPSEEK_API_KEY
# 手动下载 ECDICT sqlite,放到 data/ecdict.db
npm run dev
```

## Docker 构建

```bash
docker build -t verba-backend:dev .
docker run --rm -p 3000:3000 --env-file .env verba-backend:dev
```

构建过程会从 GitHub Release 自动下载 ECDICT 数据,内嵌进镜像。

## 部署

GitHub Actions 构建镜像推送 GHCR,服务器侧拉取运行,不再服务器本地构建。

- 国内服务器经自建新加坡代理节点访问 GHCR,docker daemon 已配 `HTTP_PROXY`
- 服务器 `/root/verba-backend/` 只需 `docker-compose.yml`(CI 自动 scp)与 `.env`(手工维护,gitignore 不被覆盖)
- GitHub Actions 监听 `main` push:
  - `build-push`:构建镜像并推送 `ghcr.io/liutianci99/verba-backend:latest`
  - `deploy`:scp compose 文件到服务器,SSH 执行 `docker compose pull && up -d`
- 构建挪到 GHA(内存充足),服务器只负责拉取,2 GB 内存机器无压力
- 用户库挂在命名卷 `verba-userdata`(`/data`),镜像更新、容器重建均不丢数据

需要的 GitHub Secrets:

```
SERVER_HOST       服务器 IP
SERVER_USER       SSH 用户
SERVER_SSH_KEY    私钥内容(整段 pem)
```

## 关联仓库

前端 [Verba](https://github.com/Liutianci99/Verba) — Flutter Android APK。
