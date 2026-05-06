# Build context is the repo root: `docker build -f services/keeper/Dockerfile .`
FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate

# Install workspace deps (the keeper depends on @solans/sdk + @solans/client).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY clients ./clients
COPY services ./services
RUN pnpm install --frozen-lockfile --filter solans-keeper...

ENV SOLANS_RPC_URL=https://api.devnet.solana.com
ENV KEEPER_INTERVAL=3600
CMD ["pnpm", "--filter", "solans-keeper", "start"]
