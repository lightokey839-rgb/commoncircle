# CommonCircle chat / NEP-413 sign-in server. Build from the repository root:
#   docker build -f deploy/Dockerfile -t commoncircle-chat .
# Runs server/auth.ts on Node 24 (type stripping, no build step). Only `pg` is installed.
FROM node:24-alpine
WORKDIR /app
COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY server/*.ts ./server/
COPY server/migrations ./server/migrations
ENV COMMONCIRCLE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001
EXPOSE 3001
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["node", "server/auth.ts"]
