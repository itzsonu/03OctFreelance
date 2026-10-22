FROM node:24-bookworm-slim AS frontend
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=5000 HOST=0.0.0.0 PRIVATE_UPLOAD_DIR=/data/uploads EVENT_EMAILS_ENABLED=false
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && mkdir -p /data/uploads && chown -R node:node /data /app
COPY --chown=node:node backend ./
COPY --from=frontend --chown=node:node /workspace/build /app/build
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node scripts/checkHealth.js http://127.0.0.1:5000
CMD ["node", "server.js"]
