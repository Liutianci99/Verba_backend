import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

describe("CORS", () => {
  it("预检 OPTIONS 反射来源", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/explain",
      headers: {
        origin: "chrome-extension://abcdefghijklmno",
        "access-control-request-method": "POST",
      },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers["access-control-allow-origin"]).toBe("chrome-extension://abcdefghijklmno");
    await app.close();
  });
});
