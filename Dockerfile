FROM node:20.20.0-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY packs ./packs

RUN npm ci
RUN npm run typecheck

ENV NODE_ENV=production

CMD ["sh", "-c", "if [ \"$SERVICE_KIND\" = \"api\" ]; then npm run migrate --workspace @tm/db && npm run packs:sync --workspace @tm/db && exec npm run start --workspace @tm/api; elif [ \"$SERVICE_KIND\" = \"worker\" ]; then exec npm run start --workspace @tm/worker; else echo 'SERVICE_KIND must be api or worker' >&2; exit 1; fi"]
