# Build context is the repo root: `docker build -f services/indexer/Dockerfile .`
FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate

# Install workspace deps (the indexer depends on @solans/sdk + @solans/client).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY clients ./clients
COPY services ./services
RUN pnpm install --frozen-lockfile --filter solans-indexer...

ENV PORT=8788
EXPOSE 8788
CMD ["pnpm", "--filter", "solans-indexer", "start"]
