# Verba Backend

Verba 背词工具的服务端。代理 ECDICT 词库查询、DeepSeek 干扰项生成、有道美音音频。

## 技术栈

- Node.js + Fastify
- PostgreSQL — ECDICT 全量 77 万词,CSV 导入
- DeepSeek API — 加入词本时预生成易混淆中文释义

## 运行

```bash
pnpm install
pnpm dev          # 本地开发
pnpm build        # 生产构建
pnpm start        # 启动生产服务
```

## 环境变量

```
DATABASE_URL        postgres://user:pass@host:5432/verba
DEEPSEEK_API_KEY    DeepSeek 调用密钥
API_KEY             单用户固定 token,客户端 Bearer 鉴权
PORT                默认 3000
```

## 部署

- 云服务器 + Docker 常驻
- GitHub Actions 监听 `main` push,构建镜像推送 registry 后 SSH 触发服务器 `docker pull` + 重启

## 关联仓库

前端 [Verba](https://github.com/Liutianci99/Verba) — Flutter Android APK。
