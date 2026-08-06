FROM oven/bun:1.3.14 AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/docs ./apps/docs
COPY docs ./docs

RUN bun install --frozen-lockfile --filter @semola/docs

ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run --filter @semola/docs build

FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/apps/docs/.next/standalone ./
COPY --from=builder /app/apps/docs/public ./apps/docs/public
COPY --from=builder /app/apps/docs/.next/static ./apps/docs/.next/static

EXPOSE 3000
CMD ["node", "apps/docs/server.js"]
