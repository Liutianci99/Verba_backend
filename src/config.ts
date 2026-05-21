import "dotenv/config";

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  apiKey: required("API_KEY"),
  deepseekApiKey: required("DEEPSEEK_API_KEY"),
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  ecdictPath: process.env.ECDICT_PATH ?? "./data/ecdict.db",
  // 用户数据库:可写,与只读 ECDICT 分离。生产环境落在 docker volume 上。
  userDbPath: process.env.USER_DB_PATH ?? "./data/verba_user.db",
};
