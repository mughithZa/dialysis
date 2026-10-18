# syntax=docker/dockerfile:1
# Builds the client, then runs the API (via tsx) and serves client/dist from the same process.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY client client
RUN npm run typecheck -w server && npm run build -w client

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# The server runs TypeScript through tsx (a devDependency), so keep the server's dev install; skip client tooling.
RUN npm ci -w shared -w server --include=dev
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY --from=build /app/client/dist client/dist
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "server"]
