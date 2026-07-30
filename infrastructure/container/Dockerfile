FROM node:24.5.0-bookworm-slim@sha256:ac365b72b69807f4b0f73bcddccffbed7307cc6e296fddf778f3c6ffd6be2381 AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && find /var/lib/apt/lists -mindepth 1 -delete
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts/container-entrypoint.sh ./scripts/container-entrypoint.sh

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24.5.0-bookworm-slim@sha256:ac365b72b69807f4b0f73bcddccffbed7307cc6e296fddf778f3c6ffd6be2381

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && find /var/lib/apt/lists -mindepth 1 -delete
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate

COPY --from=build --chown=node:node /workspace /workspace

USER node
ENTRYPOINT ["./scripts/container-entrypoint.sh"]
CMD ["api"]
