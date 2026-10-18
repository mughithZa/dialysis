# Dialysis centre POC

A proof-of-concept web app for running a small network of dialysis centres: front desk registers patients, books chairs and shifts and handles transfers between centres; nurses run each session (vitals, usage, notes); doctors write orders; centre managers manage staff, roles and settings; a program manager oversees all centres, the shared catalogue and aggregate statistics. Patients get their own phone-first view with upcoming sessions, history and push reminders. It is a phone-first PWA backed by a single Node API and MongoDB.

## Requirements

- Node.js 22 or newer (`engines.node >= 22`), npm 10+
- MongoDB 7 running as a **replica set** (transactions need one, even with a single node)
- Docker (optional, for the local MongoDB and for deployment)

## Layout

npm workspaces:

| Path | What |
| --- | --- |
| `shared/` | Types and the permission list shared by server and client (TypeScript source, no build step) |
| `server/` | Express 5 + Mongoose API, run with `tsx`; tests in `src/**/*.test.ts` (Vitest + supertest) |
| `client/` | React 18 + Mantine + Vite PWA; tests in `src/**/*.test.tsx` (Vitest + Testing Library + MSW) |
| `e2e/` | Playwright browser test of the core flow |
| `deploy/` | Docker Compose (MongoDB, app, Caddy) for a VPS — see [deploy/README.md](deploy/README.md) |
| `docs/superpowers/` | Design spec (`specs/2026-10-18-dialysis-poc-design.md`) and implementation plan (`plans/2026-10-18-dialysis-poc.md`) |

## Getting started

```sh
npm install
```

### Local MongoDB (replica set)

With Docker (data kept in the `dialysis-mongo` volume):

```sh
docker run -d --name dialysis-mongo -p 27017:27017 -v dialysis-mongo:/data/db mongo:7 --replSet rs0 --bind_ip_all
docker exec dialysis-mongo mongosh --quiet --eval "rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] })"
```

Without Docker, use the in-memory replica set from `mongodb-memory-server` (the same one the server tests use; data is lost when it stops). Run from `server/` and leave it open:

```sh
cd server
node --input-type=module -e "import { MongoMemoryReplSet } from 'mongodb-memory-server'; const r = await MongoMemoryReplSet.create({ replSet: { name: 'rs0', count: 1 }, instanceOpts: [{ port: 27017 }] }); console.log(r.getUri())"
```

Both match the default `MONGO_URL`.

### Environment variables

Read by `server/src/config.ts`. All are optional in development.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | — | `production` turns on secure cookies, trusts the proxy and serves `client/dist` |
| `MONGO_URL` | `mongodb://127.0.0.1:27017/dialysis?replicaSet=rs0` | MongoDB connection string (must be a replica set) |
| `SESSION_SECRET` | `dev-secret-change-me` | Signs the session cookie. **Required** when `NODE_ENV=production` |
| `APP_TZ` | `Asia/Damascus` | Time zone for local dates, shifts and reminders |
| `PORT` | `3000` | API port |
| `VAPID_PUBLIC`, `VAPID_PRIVATE` | empty | Web-push keys (`npx web-push generate-vapid-keys`); without them reminders are off |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Web-push contact |

### Run in development

```sh
npm run dev          # API on :3000 (tsx watch); creates missing default roles on start
npm run dev:client   # Vite on :5173, proxies /api to :3000
```

Open http://localhost:5173.

### Accounts

Either seed demo data (two centres, staff, 20 patients, a few weeks of history; all passwords `demo1234`, program manager `pm`; does nothing if `pm` exists):

```sh
ALLOW_DEMO_SEED=1 npm run seed:demo -w server
```

or create just the first program manager (refuses if one already exists; password at least 8 characters):

```sh
CREATE_PM_USERNAME=pm CREATE_PM_NAME="Program Manager" CREATE_PM_PASSWORD=secret123 npm run create-pm -w server
```

## Tests and checks

```sh
npm test                    # server + client unit/integration tests (server starts its own in-memory MongoDB)
npm run e2e                 # builds the client, then runs Playwright against an in-memory DB + production server
npm run typecheck -w server
npm run typecheck -w client
npm run build -w client     # typecheck + production build into client/dist
```

The first `npm run e2e` may need `npx playwright install chromium`.

## Deployment

See [deploy/README.md](deploy/README.md) (Docker Compose with MongoDB, the app and Caddy for HTTPS).
