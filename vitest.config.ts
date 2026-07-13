import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      API_KEY: "test-key",
      DEEPSEEK_API_KEY: "test-deepseek-key",
      ECDICT_PATH: "./.tmp-test/ecdict.db",
      USER_DB_PATH: "./.tmp-test/user.db",
    },
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
  },
});
