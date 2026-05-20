# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install --registry=https://registry.npmmirror.com

FROM base AS data
WORKDIR /data
RUN curl -fsSL -o ecdict.zip "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip" \
    && unzip -q ecdict.zip \
    && rm ecdict.zip \
    && ls -la

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV ECDICT_PATH=/app/data/ecdict.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=data /data/stardict.db ./data/ecdict.db
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
