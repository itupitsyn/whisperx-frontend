# ---------- build stage ----------
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

# Исходники и сборка
COPY . .

ARG WHISPERX_API_URL
ENV WHISPERX_API_URL=$WHISPERX_API_URL
# Собираем Nitro под нативный bun-сервер (Bun.serve), а не node-server
ENV NITRO_PRESET=bun
RUN bun run build

# ---------- runtime stage ----------
FROM oven/bun:1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=build /app/.output ./.output

EXPOSE 3000
CMD ["bun", "run", "/app/.output/server/index.mjs"]
