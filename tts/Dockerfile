# syntax=docker/dockerfile:1.7
# Kokoro-82M TTS 边车。模型烘进镜像(与 ECDICT 同思路),启动即可用,无运行时下载。
#
# 刻意不装 misaki:kokoro-onnx 0.5.0 用自带的 espeak-ng 做音素化,
# 实测装与不装输出逐样本哈希一致,而 misaki[en] 会拖进 torch + 2.7G CUDA 库
# (CPU 机器上纯属死重),镜像从 298MB 涨到 3.1GB。
FROM python:3.12-slim AS models
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /models
ARG KOKORO_RELEASE=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
RUN curl -fsSL -o kokoro-v1.0.onnx "${KOKORO_RELEASE}/kokoro-v1.0.onnx" \
    && curl -fsSL -o voices-v1.0.bin "${KOKORO_RELEASE}/voices-v1.0.bin" \
    && ls -lh

FROM python:3.12-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir \
      numpy soundfile onnxruntime kokoro-onnx fastapi "uvicorn[standard]"

COPY --from=models /models /models
WORKDIR /app
COPY server.py ./

ENV KOKORO_MODEL=/models/kokoro-v1.0.onnx \
    KOKORO_VOICES=/models/voices-v1.0.bin \
    KOKORO_VOICE=af_heart \
    OMP_NUM_THREADS=2 \
    ORT_INTRA_OP_THREADS=2

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
