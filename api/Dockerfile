FROM node:22-alpine AS build
RUN corepack enable && apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
COPY api/package.json api/
RUN pnpm install --frozen-lockfile --filter @gws/api...
COPY api api
RUN pnpm --filter @gws/api prisma:generate && pnpm --filter @gws/api build
FROM node:22-alpine
RUN apk add --no-cache chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/api
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
