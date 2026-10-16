# ---- build: install everything, compile server + SDK, bundle the dashboard ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY sdk/package.json sdk/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime: just node, production deps and built files ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4000 DATABASE_PATH=/data/linkforge.db TRUST_PROXY=1
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
