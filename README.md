# Verba Backend

Verba 背词工具的服务端。代理 ECDICT 词库查询、DeepSeek 干扰项生成、有道美音音频。

## 技术栈

- Node.js 22 + Fastify 5 + TypeScript
- better-sqlite3 + ECDICT 全量 77 万词(构建时下载,内嵌镜像)
- DeepSeek API 预生成易混淆中文释义

## 接口

所有业务接口需 Bearer 鉴权:`Authorization: Bearer <API_KEY>`。`/health` 不需要。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/dict/:word` | 查词,返回 ECDICT 行 |
| POST | `/distractors` | body `{word, meaning}`,返回 3 个易混淆中文释义 |
| GET | `/audio/:word?type=2` | 美音音频流(type=1 英音、2 美音) |

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

服务器 `/root/verba-backend/` 放 `docker-compose.yml` + `.env`。CI 监听 `main` push:

1. 构建镜像并推送 `ghcr.io/<owner>/verba_backend:latest`
2. SSH 触发服务器 `docker compose pull && docker compose up -d`

需要的 GitHub Secrets:

```
SERVER_HOST       服务器 IP
SERVER_USER       SSH 用户
SERVER_SSH_KEY    私钥内容(整段 pem)
```

## 关联仓库

前端 [Verba](https://github.com/Liutianci99/Verba) — Flutter Android APK。
