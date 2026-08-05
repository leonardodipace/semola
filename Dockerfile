FROM oven/bun:1.3.14 AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/docs ./apps/docs
COPY docs ./docs

RUN bun install --frozen-lockfile

ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run docs:build \
	&& cp -r apps/docs/public apps/docs/.next/standalone/apps/docs/ \
	&& cp -r apps/docs/.next/static apps/docs/.next/standalone/apps/docs/.next/

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/apps/docs/.next/standalone ./

EXPOSE 3000
CMD ["node", "apps/docs/server.js"]
