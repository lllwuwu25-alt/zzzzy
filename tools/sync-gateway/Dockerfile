FROM node:24.22.0-bookworm-slim AS frontend-build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
ARG VITE_SYNC_GATEWAY_URL
ENV VITE_SYNC_GATEWAY_URL=${VITE_SYNC_GATEWAY_URL}
ENV VITE_CLOUD_MOBILE=true
RUN npm run build

FROM node:24.22.0-bookworm-slim AS gateway
WORKDIR /app
RUN mkdir -p /data /backups && chown 10001:10001 /data /backups
COPY tools/sync-gateway/package.json ./package.json
COPY tools/sync-gateway/config.mjs tools/sync-gateway/db.mjs tools/sync-gateway/crypto.mjs tools/sync-gateway/auth.mjs tools/sync-gateway/bindings.mjs tools/sync-gateway/server.mjs tools/sync-gateway/feishu.mjs tools/sync-gateway/sync.mjs tools/sync-gateway/backup.mjs ./
COPY tools/sync-gateway/migrations ./migrations
ENV NODE_ENV=production APP_ENV=staging HOST=0.0.0.0 PORT=8787 DATABASE_URL=file:/data/sync.db
USER 10001:10001
EXPOSE 8787
CMD ["node", "server.mjs"]

FROM caddy:2.10.2-alpine AS web
RUN mkdir -p /data /config && chown -R 10001:10001 /data /config
COPY --from=frontend-build /build/dist /srv
COPY tools/sync-gateway/deploy/Caddyfile /etc/caddy/Caddyfile
USER 10001:10001
EXPOSE 8080 8443
