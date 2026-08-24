# Single image: the Express API also serves the built PWA, so the service
# worker and /api share one origin.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Both workspace manifests are copied so the lockfile still validates, but only
# the backend workspace is installed — the frontend's React/MUI tree is build
# input, not runtime code, and has no business in the shipped image.
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN npm ci --omit=dev --workspace backend --include-workspace-root \
  && npm cache clean --force

COPY backend/ backend/
COPY database/ database/
COPY --from=build /app/frontend/dist frontend/dist

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# The database lives on a volume so it survives a container replacement. It has
# to be writable by the unprivileged user the server runs as, and the migration
# step on boot writes here before anything is served.
ENV DATABASE_FILE=/data/investments.sqlite
ENV PORT=4000
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
EXPOSE 4000

USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
