# syntax=docker/dockerfile:1

FROM node:24.15.0-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm ci --include=dev --no-audit --no-fund --registry=$NPM_REGISTRY

COPY . .

RUN npm run typecheck && npm run typecheck:web && npm run typecheck:web:v2 && npm run typecheck:web:v2-tests && NODE_ENV=test npm run test && npm run build:web && npm run build:web:v2

EXPOSE 3000
CMD ["node", "server/index.ts"]
