"""Verba TTS 边车:Kokoro-82M(ONNX/CPU)合成美音,返回 MP3。

只在内网 docker 网络暴露,由 verba-backend 调用,不直接对外。
模型在启动时加载一次(冷加载约 1.5s),之后常驻内存。
"""
import logging
import os
import threading
import time
from contextlib import asynccontextmanager

import lameenc
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from kokoro_onnx import Kokoro
from pydantic import BaseModel, Field

MODEL_PATH = os.environ.get("KOKORO_MODEL", "/models/kokoro-v1.0.onnx")
VOICES_PATH = os.environ.get("KOKORO_VOICES", "/models/voices-v1.0.bin")
DEFAULT_VOICE = os.environ.get("KOKORO_VOICE", "af_heart")
MAX_CHARS = int(os.environ.get("TTS_MAX_CHARS", "600"))
INTRA_THREADS = int(os.environ.get("ORT_INTRA_OP_THREADS", "2"))
MP3_BITRATE = int(os.environ.get("TTS_MP3_BITRATE", "64"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("verba-tts")

_kokoro: Kokoro | None = None
# onnxruntime 会话非线程安全,且 2 vCPU 上并发无收益(单请求已吃满两核),串行化
_lock = threading.Lock()


def _build_kokoro() -> Kokoro:
    """尽量显式设定 ORT 线程数吃满 2 vCPU;拿不到 from_session 就退回默认构造。"""
    try:
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = INTRA_THREADS
        opts.inter_op_num_threads = 1
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        session = ort.InferenceSession(
            MODEL_PATH, sess_options=opts, providers=["CPUExecutionProvider"]
        )
        return Kokoro.from_session(session, VOICES_PATH)
    except Exception as e:
        log.warning("from_session unavailable (%s), falling back to default init", e)
        return Kokoro(MODEL_PATH, VOICES_PATH)


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _kokoro
    t0 = time.time()
    _kokoro = _build_kokoro()
    # 预热:首次推理要建内核缓存,提前吃掉这份开销,别让第一个真实请求付
    try:
        with _lock:
            _kokoro.create("warm up", voice=DEFAULT_VOICE, speed=1.0, lang="en-us")
    except Exception as e:
        log.warning("warmup failed: %s", e)
    log.info("kokoro ready in %.2fs, voice=%s threads=%d",
             time.time() - t0, DEFAULT_VOICE, INTRA_THREADS)
    yield


app = FastAPI(title="verba-tts", lifespan=lifespan)


class SynthRequest(BaseModel):
    text: str = Field(min_length=1)
    voice: str | None = None
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


@app.get("/health")
def health() -> dict:
    return {"status": "ok" if _kokoro is not None else "loading"}


@app.get("/voices")
def voices() -> dict:
    if _kokoro is None:
        raise HTTPException(503, "model loading")
    return {"voices": sorted(_kokoro.get_voices())}


def _to_mp3(samples: np.ndarray, rate: int) -> bytes:
    """
    float32 采样直接编成 MP3。

    原先靠 ffmpeg 子进程转码,但为这一件事拖进 458MB 的 apt 依赖树,
    且每次请求都要 fork。lameenc 是同一个 LAME 编码器的 Python 绑定,
    约 100KB,进程内完成。

    24kHz 单声道语音 64kbps 已经透明(与原先 ffmpeg -qscale:a 4 实测码率一致)。
    """
    pcm = np.clip(samples, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype(np.int16)

    enc = lameenc.Encoder()
    enc.set_bit_rate(MP3_BITRATE)
    enc.set_in_sample_rate(rate)
    enc.set_channels(1)
    enc.set_quality(2)  # 2 = 高质量(慢),语音短句无所谓
    mp3 = enc.encode(pcm.tobytes())
    mp3 += enc.flush()
    if not mp3:
        raise HTTPException(500, "mp3 encode produced no output")
    return bytes(mp3)


@app.post("/synth")
def synth(req: SynthRequest) -> Response:
    if _kokoro is None:
        raise HTTPException(503, "model loading")
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "text required")
    if len(text) > MAX_CHARS:
        raise HTTPException(413, f"text too long (max {MAX_CHARS})")

    voice = req.voice or DEFAULT_VOICE
    t0 = time.time()
    with _lock:
        try:
            samples, rate = _kokoro.create(text, voice=voice, speed=req.speed, lang="en-us")
        except Exception as e:  # 音色名错误 / 音素化失败
            log.warning("synth failed for %r: %s", text[:60], e)
            raise HTTPException(400, f"synth failed: {e}") from e
    synth_s = time.time() - t0
    mp3 = _to_mp3(samples, rate)
    log.info("synth %r voice=%s %.2fs -> %dB", text[:40], voice, synth_s, len(mp3))

    return Response(
        content=mp3,
        media_type="audio/mpeg",
        headers={
            "X-Synth-Voice": voice,
            "X-Synth-Rate": str(rate),
            "X-Synth-Ms": str(int(synth_s * 1000)),
        },
    )
