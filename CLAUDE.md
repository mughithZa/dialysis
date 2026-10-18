# Dialysis Centre Software

Proof of concept for UOCA charity dialysis centres (Syria). One web app (installable PWA) for six roles: program manager, centre manager, front desk, nurse, doctor, patient. Specs and plans: `docs/superpowers/specs/`, `docs/superpowers/plans/`. Developer guide: `README.md`. Deployment: `deploy/README.md`.

## Layout
- `shared/` — permission catalogue and shared types (`@dialysis/shared`)
- `server/` — Express 5 + Mongoose on a MongoDB replica set; code by feature (`schedule/`, `sessions/`, `patients/`, `transfers/`, …), tests colocated `*.test.ts`
- `client/` — React 18 + Vite 8 + Mantine 7 + TanStack Query, i18n in `client/src/i18n/en.json`
- `e2e/` — Playwright core-flow test; `deploy/` — Docker Compose (mongo, app, caddy)

## Commands
- `npm test` (server + client), `npm run typecheck -w server|client`, `npm run build -w client`, `npm run e2e`
- `npm run dev` (API :3000) and `npm run dev:client`
- `npm run create-pm -w server`, `npm run migrate:v2 -w server`, `npm run seed:demo -w server` (demo data only)

## Rules that matter
- Every staff route is `/api/centres/:centreId/...` behind `requirePerm(...)`; another centre's record is 404, never 403. Patients only use `/api/me/*`.
- "Is this slot free" is decided only in `server/src/schedule/slots.ts`; every booking write locks (centre lock → patient plan lock → slot locks) inside a transaction.
- Past/final sessions are never rewritten: sessions store snapshots (`shiftStart`, `shiftEnd`, `chairLabel`, `rosterNurseId`).
- Dates are `YYYY-MM-DD` in `APP_TZ` (Asia/Damascus); weekdays 0=Sunday, UI lists start Saturday.
- All UI text through `t()`; phone-first, touch targets ≥ 44 px; colours only in `client/src/theme.ts`.
- Write tests first; keep `npm test`, typechecks and the client build clean before committing.

## Production server (this VPS)
- Code in `/opt/dialysis`, secrets in `deploy/.env` (never commit or print them).
- Update: `git pull && docker compose -f deploy/docker-compose.yml --env-file deploy/.env -p dialysis up -d --build`
- Logs: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env -p dialysis logs -f app`
- Never run `docker compose down -v` (deletes the database volume). Take a `mongodump` before migrations.
