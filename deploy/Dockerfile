FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
ENV NODE_ENV=production
RUN npm run build
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DEMO_LOGIN_ENABLED=false AUTH_SECURE_COOKIE=true
COPY --from=build /app /app
EXPOSE 3000
USER node
CMD ["node", "deploy/start-preview.cjs"]
