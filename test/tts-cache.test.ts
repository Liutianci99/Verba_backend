import { describe, it, expect, vi, beforeEach } from "vitest";
import { rmSync, existsSync, readdirSync } from "node:fs";

const CACHE = "./.tmp-test/audio";
const MP3 = Buffer.from("ID3fake-mp3-bytes");

const synth = vi.fn(async () => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => MP3.buffer.slice(MP3.byteOffset, MP3.byteOffset + MP3.byteLength),
}));

vi.mock("undici", () => ({ fetch: (...a: unknown[]) => synth(...(a as [])) }));

describe("发音缓存", () => {
  beforeEach(() => {
    rmSync(CACHE, { recursive: true, force: true });
    synth.mockClear();
    vi.resetModules();
  });

  it("首次合成并落盘,二次直接读缓存不再调 TTS", async () => {
    const { getAudio, US_VOICE } = await import("../src/tts.js");

    const first = await getAudio("directionality", US_VOICE);
    expect(first.cached).toBe(false);
    expect(first.buf.equals(MP3)).toBe(true);
    expect(synth).toHaveBeenCalledTimes(1);
    expect(existsSync(CACHE)).toBe(true);

    const second = await getAudio("directionality", US_VOICE);
    expect(second.cached).toBe(true);
    expect(second.buf.equals(MP3)).toBe(true);
    expect(synth).toHaveBeenCalledTimes(1); // 没有再打 TTS
  });

  it("并发请求同一个词只合成一次", async () => {
    const { getAudio, US_VOICE } = await import("../src/tts.js");
    const [a, b, c] = await Promise.all([
      getAudio("volatility", US_VOICE),
      getAudio("volatility", US_VOICE),
      getAudio("volatility", US_VOICE),
    ]);
    expect(synth).toHaveBeenCalledTimes(1);
    for (const r of [a, b, c]) expect(r.buf.equals(MP3)).toBe(true);
  });

  it("大小写与首尾空格视为同一个词,共用一份缓存", async () => {
    const { getAudio, US_VOICE } = await import("../src/tts.js");
    await getAudio("Hedge", US_VOICE);
    await getAudio("  hedge  ", US_VOICE);
    expect(synth).toHaveBeenCalledTimes(1);
  });

  it("不同音色各自缓存,互不覆盖", async () => {
    const { getAudio, US_VOICE, UK_VOICE } = await import("../src/tts.js");
    await getAudio("run", US_VOICE);
    await getAudio("run", UK_VOICE);
    expect(synth).toHaveBeenCalledTimes(2);
    expect(readdirSync(CACHE).filter((f) => f.endsWith(".mp3"))).toHaveLength(2);
  });

  it("TTS 失败时不写缓存,后续请求会重试", async () => {
    const { getAudio, US_VOICE } = await import("../src/tts.js");
    synth.mockImplementationOnce(async () => ({
      ok: false,
      status: 503,
      text: async () => "model loading",
      arrayBuffer: async () => new ArrayBuffer(0),
    }) as never);

    await expect(getAudio("arbitrage", US_VOICE)).rejects.toThrow(/503/);
    const files = existsSync(CACHE) ? readdirSync(CACHE) : [];
    expect(files.filter((f) => f.includes("arbitrage"))).toHaveLength(0);

    const retry = await getAudio("arbitrage", US_VOICE);
    expect(retry.buf.equals(MP3)).toBe(true);
  });
});
