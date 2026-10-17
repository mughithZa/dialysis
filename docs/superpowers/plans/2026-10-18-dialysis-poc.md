# Dialysis Centre POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone-first installable web app (PWA) where UOCA dialysis centres run their whole daily flow: centres, dynamic roles, patients, weekly chair schedule, sessions with medicine/supply usage, doctor orders, transfers, the shared medicine list and monthly reports.

**Architecture:** npm-workspaces monorepo: `server/` (Express REST API + Mongoose on MongoDB), `client/` (Vite + React SPA, Mantine UI, PWA), `shared/` (permission catalogue and shared types). Every staff API route is centre-scoped (`/api/centres/:centreId/...`) and guarded server-side by `requirePerm`; patients use `/api/me/...`. The data model is relational in shape (separate collections referencing by id) so it maps straight to PostgreSQL later.

**Tech Stack:** Node 22 LTS, TypeScript 5, Express 5, Mongoose 8, MongoDB 7 (single-node replica set), zod, express-session + connect-mongo, bcryptjs, luxon, node-cron, web-push · React 18, Vite 5, React Router 6, TanStack Query 5, Mantine 7, react-i18next, vite-plugin-pwa · Vitest, supertest, mongodb-memory-server (`MongoMemoryReplSet`), React Testing Library, MSW, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-dialysis-poc-design.md` (read it alongside this plan; it wins on intent).

## Global Constraints

- Node 22 LTS; TypeScript `strict: true` in every workspace.
- All dates for scheduling are local-date strings `YYYY-MM-DD` in the app timezone `APP_TZ` (default `Asia/Damascus`); weekdays use JS numbering `0=Sunday … 6=Saturday`; shift times are `HH:mm` strings.
- Every staff route is under `/api/centres/:centreId/` and protected by `requirePerm(<key>)`; a record whose `centreId` differs from the route's `:centreId` returns **404**, never 403 (don't reveal existence).
- Cross-centre data appears only in `GET /api/stats` (aggregates, no patient/staff/chair identity).
- Patients only ever reach `/api/me/*`; patient accounts have no centre roles.
- API errors are JSON `{ "error": "<code>" }` with 400 (validation), 401, 403, 404, 409 (conflict).
- Multi-document writes (list merge, transfer accept, booking) run in a Mongo transaction.
- All UI text goes through `react-i18next` (`client/src/i18n/en.json`); CSS uses logical properties (`margin-inline-start`, not `margin-left`); colours/fonts only in `client/src/theme.ts`. Neutral look, no UOCA branding.
- Phone first: every screen usable at 360 px width, touch targets ≥ 44 px.
- No exports, no SMS, no offline mode, no store apps.
- Light security only: hashed passwords (bcrypt), httpOnly session cookie, HTTPS at the proxy, server-side access checks.

## Review Focus

1. **Cross-centre ID guessing:** a front-desk user of centre A requests `/api/centres/A/patients/<id of a centre-B patient>` (and the same for sessions, orders, transfers) → 404. Test owned by Task 7 (patients) and Task 11 (sessions).
2. **Two people booking the same slot at once:** two concurrent `POST /api/centres/:c/patients/:id/pattern` (different patients) for the same chair/shift/weekday → exactly one 201, one 409. Test owned by Task 8.
3. **After a transfer is accepted, the old centre's staff (including a doctor linked to both centres only through the old centre) can no longer read the patient, while the old centre's monthly stats still count the sessions held there.** Test owned by Task 14 (access) and Task 15 (stats).
4. **Late-evening timezone edge:** at 23:30 Damascus time (20:30 UTC) "today" and the missed-session job use the Damascus date, not UTC. Test owned by Task 9.
5. **Merging a pending item that already has usage:** usage lines re-point to the surviving item, totals in stats equal the sum, and a merge across different units → 400. Test owned by Task 10 (merge) and Task 15 (stats).

---

## File Structure

```
package.json                     workspaces: shared, server, client
shared/src/permissions.ts        permission catalogue + categories
shared/src/types.ts              DTO types shared by server and client
server/src/index.ts              boot: connect db, start jobs, listen
server/src/app.ts                createApp(): express app, routers, error handler
server/src/config.ts             env config
server/src/db.ts                 connectDb / withTransaction
server/src/lib/{dates,errors,validate}.ts
server/src/auth/                 user model, password, session login, middleware, roles (model, seed, admin routes)
server/src/audit/                audit model, recordAudit, routes
server/src/centres/              centre model, PM routes, settings, chairs & shifts
server/src/users/                centre user management routes
server/src/patients/             patient model + routes
server/src/schedule/             pattern, slot, chair-assignment models; booking service; generation; routes
server/src/sessions/             session, usage line, session change models; service; routes
server/src/orders/               doctor orders
server/src/catalog/              units + items, merge
server/src/transfers/            transfer model, service, routes
server/src/reports/              stats aggregation
server/src/me/                   patient endpoints
server/src/notify/               push subscriptions, sender, jobs (missed, reminders)
server/src/seed/demo.ts          demo data script
server/test/{setup,factories}.ts test harness
client/src/                      main, api, i18n, theme, auth, layout, features/<role>/...
e2e/core-flow.spec.ts            Playwright end-to-end core flow
deploy/                          docker-compose.yml, Caddyfile, README.md
```

Server tests are colocated as `*.test.ts` next to the code.

---

## Part A — Server

### Task 1: Monorepo, server skeleton and test harness

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `shared/package.json`, `shared/src/index.ts`
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`
- Create: `server/src/{app.ts,index.ts,config.ts,db.ts}`, `server/src/lib/{errors.ts,validate.ts,dates.ts}`
- Create: `server/test/setup.ts`
- Test: `server/src/app.test.ts`, `server/src/lib/dates.test.ts`

**Interfaces:**
- Produces:
  - `createApp(): express.Express` — JSON body, session middleware (connect-mongo store), routers mounted under `/api`, error handler mapping `HttpError` → `{error}`.
  - `class HttpError extends Error { constructor(status: number, code: string) }`; helpers `notFound()`, `forbidden()`, `conflict(code)`, `badRequest(code)`.
  - `validate(schema: ZodSchema, part?: 'body'|'query')` middleware → 400 `{error:'validation', issues}`.
  - `withTransaction<T>(fn: (s: ClientSession) => Promise<T>): Promise<T>` in `db.ts`.
  - `config = { mongoUrl, sessionSecret, appTz, port, vapidPublic, vapidPrivate, vapidSubject }`.
  - `dates.ts`: `todayLocal(now?: Date): string`, `weekdayOf(date: string): number`, `addDays(date: string, n: number): string`, `localDateTime(date: string, hhmm: string): Date`, `monthRange(month: 'YYYY-MM'): {from: string, to: string}`.
  - Test harness: `server/test/setup.ts` starts one `MongoMemoryReplSet` per test file (`beforeAll`), connects mongoose, clears all collections in `beforeEach`, stops in `afterAll`. Registered in `vitest.config.ts` `setupFiles`.

- [ ] **Step 1: Scaffold workspaces** — root `package.json` with `"workspaces": ["shared","server","client"]`, scripts `test` (runs server then client tests), `dev`. Install server deps listed in Tech Stack. `.gitignore`: `node_modules`, `dist`, `.env`, `playwright-report`.

- [ ] **Step 2: Write failing tests**

```ts
// server/src/app.test.ts
it('GET /api/health returns ok', async () => {
  const res = await request(createApp()).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
it('unknown api route → 404 json', async () => {
  const res = await request(createApp()).get('/api/nope');
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'not_found' });
});

// server/src/lib/dates.test.ts  (APP_TZ=Asia/Damascus, UTC+3)
it('todayLocal uses Damascus date late in the evening', () => {
  expect(todayLocal(new Date('2026-10-18T21:30:00Z'))).toBe('2026-10-19');
});
it('weekdayOf', () => { expect(weekdayOf('2026-10-17')).toBe(6); }); // Saturday
it('localDateTime', () => {
  expect(localDateTime('2026-10-19', '07:00').toISOString()).toBe('2026-10-19T04:00:00.000Z');
});
it('monthRange', () => { expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' }); });
```

- [ ] **Step 3: Run** `npm test -w server` — Expected: FAIL (modules missing).
- [ ] **Step 4: Implement** the files above (luxon for dates; `/api/health`; 404 fallthrough for `/api/*`).
- [ ] **Step 5: Run** `npm test -w server` — Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "chore: monorepo, server skeleton, test harness"`

---

### Task 2: Permission catalogue, roles and seeded defaults

**Files:**
- Create: `shared/src/permissions.ts`
- Create: `server/src/auth/role.model.ts`, `server/src/auth/roles.seed.ts`, `server/src/auth/effective.ts`
- Test: `server/src/auth/roles.test.ts`

**Interfaces:**
- Produces:
  - `PERMISSIONS` — readonly array of `{ key, category }`; `type Permission` = union of keys; `GLOBAL_PERMISSIONS: Permission[]`; `CATEGORIES` ordered list. Keys (exact):
    - Centres: `centres.create`, `centres.close`, `stats.global`, `managers.manage`
    - Users & roles: `users.create`, `users.edit`, `users.resetPassword`, `roles.assign`, `roles.edit`
    - Patients: `patients.view`, `patients.create`, `patients.edit`, `patients.discharge`, `transfers.send`, `transfers.decide`
    - Schedule: `schedule.view`, `schedule.book`, `schedule.makeup`, `schedule.setup`, `schedule.assignNurses`
    - Sessions: `sessions.view`, `sessions.run`, `sessions.postpone`, `sessions.recordUsage`, `sessions.recordVitals`, `sessions.addNotes`, `sessions.editClosed`, `sessions.viewHistory`
    - Doctor orders: `orders.view`, `orders.write`
    - Medicine & supply list: `catalog.view`, `catalog.add`, `catalog.manage`
    - Reports & audit: `reports.centre`, `audit.view`
    - Centre settings: `settings.centre`
    - `GLOBAL_PERMISSIONS` = `centres.create, centres.close, stats.global, managers.manage, roles.edit, catalog.manage`.
  - `Role` model: `{ key: string (unique), name: string, scope: 'global'|'centre', permissions: Permission[], system: boolean }`. A `centre`-scope role may not contain global permissions (validation error `global_perm_in_centre_role`).
  - `seedRoles(): Promise<void>` — idempotent upsert of the defaults below (only inserts when missing; never overwrites edits).
  - `effectivePermissions(user: UserDoc, centreId: string | null): Promise<Set<Permission>>` — union of the user's global roles plus, when `centreId` is given, the roles of the user's membership in that centre. Empty set if no membership.

Default roles (key → permissions):
- `program_manager` (global): all `GLOBAL_PERMISSIONS`.
- `centre_manager`: `patients.view, schedule.view, schedule.setup, sessions.view, sessions.editClosed, sessions.viewHistory, orders.view, catalog.view, users.create, users.edit, users.resetPassword, roles.assign, reports.centre, audit.view, settings.centre`.
- `front_desk`: `patients.view, patients.create, patients.edit, patients.discharge, transfers.send, transfers.decide, schedule.view, schedule.book, schedule.makeup, schedule.assignNurses, sessions.view, sessions.postpone, users.create, users.resetPassword, catalog.view, catalog.add`.
- `nurse`: `patients.view, schedule.view, sessions.view, sessions.run, sessions.postpone, sessions.recordUsage, sessions.recordVitals, sessions.addNotes, sessions.editClosed, sessions.viewHistory, orders.view, catalog.view, catalog.add`.
- `doctor`: `patients.view, sessions.view, sessions.viewHistory, orders.view, orders.write, catalog.view, catalog.add`.

- [ ] **Step 1: Write failing tests**

```ts
it('seedRoles inserts five defaults and is idempotent', async () => {
  await seedRoles(); await seedRoles();
  expect(await Role.countDocuments()).toBe(5);
});
it('seedRoles does not overwrite an edited role', async () => {
  await seedRoles();
  await Role.updateOne({ key: 'front_desk' }, { $push: { permissions: 'sessions.recordUsage' } });
  await seedRoles();
  expect((await Role.findOne({ key: 'front_desk' }))!.permissions).toContain('sessions.recordUsage');
});
it('centre role cannot hold a global permission', async () => {
  await expect(Role.create({ key: 'x', name: 'X', scope: 'centre', permissions: ['stats.global'], system: false }))
    .rejects.toThrow(/global_perm_in_centre_role/);
});
it('every default permission is in the catalogue', () => { /* iterate seeds, assert PERMISSIONS has key */ });
```
(`effectivePermissions` is tested in Task 3 once users exist.)

- [ ] **Step 2: Run** `npm test -w server -- roles` — Expected: FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: permission catalogue and default roles`

---

### Task 3: Users, login and access middleware

**Files:**
- Create: `server/src/auth/user.model.ts`, `server/src/auth/password.ts`, `server/src/auth/middleware.ts`, `server/src/auth/routes.ts`
- Create: `server/test/factories.ts`
- Test: `server/src/auth/auth.test.ts`

**Interfaces:**
- Consumes: `Role`, `seedRoles`, `effectivePermissions` (Task 2).
- Produces:
  - `User` model: `{ username (unique, lowercase), passwordHash, name, phone?, kind: 'staff'|'patient', active: boolean, globalRoleIds: ObjectId[], memberships: [{ centreId: ObjectId, roleIds: ObjectId[] }] }`.
  - `hashPassword(p): Promise<string>`, `verifyPassword(p, hash): Promise<boolean>`.
  - Routes: `POST /api/auth/login {username,password}` → 200 `{ user: MeDto }` (401 `bad_credentials` for wrong password, inactive user, or every centre membership in a closed centre with no global role); `POST /api/auth/logout`; `GET /api/auth/me` → `MeDto`.
  - `MeDto` (in `shared/src/types.ts`): `{ id, name, kind, globalPermissions: Permission[], centres: [{ id, name, permissions: Permission[] }] }` — closed centres excluded.
  - Middleware: `requireAuth`, `requirePerm(p: Permission)` (global perms checked without centre; centre perms use `req.params.centreId`; 403 `forbidden` when missing; also 404 if centre is closed), `requirePatient` (kind `patient`). Sets `req.user`, `req.perms`.
  - Factories: `createUser(opts: { username, password?='pass1234', name?, kind?, globalRoleKeys?: string[], memberships?: { centreId, roleKeys: string[] }[] }): Promise<UserDoc>`, `login(username, password?='pass1234'): Promise<supertest.Agent>` (agent with session cookie, uses a shared `createApp()` instance).

- [ ] **Step 1: Write failing tests**

```ts
beforeEach(seedRoles);
it('logs in and returns permissions per centre', async () => {
  const c = await Centre.create({ name: 'C1' }); // minimal Centre model stub from Task 5 — create model file now with { name, status:'active' }
  await createUser({ username: 'fd', memberships: [{ centreId: c.id, roleKeys: ['front_desk'] }] });
  const res = await (await login('fd')).get('/api/auth/me');
  expect(res.body.centres[0].permissions).toContain('patients.create');
});
it('union of two roles in one centre', async () => { /* centre_manager + front_desk → has audit.view and patients.create */ });
it('wrong password → 401 bad_credentials', async () => { /* ... */ });
it('requirePerm: nurse cannot create patient → 403', async () => { /* POST /api/centres/:c/patients via a test-only route; here mount a probe route in the test app */ });
it('requirePerm: member of A calling /api/centres/B/... → 403', async () => {});
```
Note: create `server/src/centres/centre.model.ts` here with `{ name, status: 'active'|'closed', settings: { patientsSeeNotes: false, reminderHours: 24 } }`; Task 5 adds routes.

- [ ] **Step 2: Run** `npm test -w server -- auth` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: users, login, permission middleware`

---

### Task 4: Audit log

**Files:**
- Create: `server/src/audit/audit.model.ts`, `server/src/audit/record.ts`, `server/src/audit/routes.ts`
- Test: `server/src/audit/audit.test.ts`

**Interfaces:**
- Produces:
  - `AuditEntry` model `{ at: Date, userId, centreId: ObjectId|null, action: string, entity: string, entityId: string, details?: object }`.
  - `recordAudit(req: Request, action: string, entity: string, entityId: string, details?: object, session?: ClientSession): Promise<void>` — every create/update/delete service in later tasks calls this. Action naming: `<entity>.<verb>` e.g. `patient.create`, `session.close`.
  - `GET /api/centres/:centreId/audit?userId=&from=&to=` (`audit.view`) → newest first, max 200, each `{ at, user: {id,name}, action, entity, entityId, details }`.

- [ ] **Step 1: Write failing test** — `recordAudit` twice in centre A, once in centre B; centre manager of A gets exactly the 2 A entries; `userId` filter works; nurse → 403.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: audit log`

---

### Task 5: Centres, chairs, shifts and settings

**Files:**
- Modify: `server/src/centres/centre.model.ts`
- Create: `server/src/centres/chair.model.ts`, `server/src/centres/shift.model.ts`, `server/src/centres/routes.ts`
- Modify: `server/test/factories.ts`
- Test: `server/src/centres/centres.test.ts`

**Interfaces:**
- Produces:
  - `Chair { centreId, label: string, active: boolean }` (unique `centreId+label`); `Shift { centreId, name, start: 'HH:mm', end: 'HH:mm', active }`.
  - Program manager (global perms):
    - `GET /api/centres` (`stats.global` or any membership) → PM sees all `{id,name,status}`; staff see their own.
    - `POST /api/centres {name, manager: {username, password, name, phone?}}` (`centres.create`) → 201 `{ centre, managerId }`; creates the user with `centre_manager` membership.
    - `POST /api/centres/:id/close` (`centres.close`) → 409 `has_active_patients` if any patient with `status` in `active|transferring` (Patient model from Task 7; until then count is 0 — the test for this case lives in Task 7); `POST /api/centres/:id/reopen`.
    - `GET /api/centres/:id/managers`, `POST /api/centres/:id/managers/:userId/reset-password {password}` (`managers.manage`) — only users holding `centre_manager` in that centre, else 404.
  - Centre manager:
    - `GET|PATCH /api/centres/:centreId/settings {patientsSeeNotes: boolean, reminderHours: integer 1..72}` (`settings.centre`).
    - `GET|POST /api/centres/:centreId/chairs`, `PATCH .../chairs/:id {label?, active?}`; same for `shifts` (`schedule.setup` to write, `schedule.view` to read). Shift `start < end` else 400.
  - Factories: `makeCentre(opts?: { name?, chairs?: number, shifts?: {name,start,end}[] }): Promise<{ centre, chairs: ChairDoc[], shifts: ShiftDoc[] }>` (defaults: 4 chairs labelled `1..4`, shifts Morning 07:00–11:30 and Afternoon 12:00–16:30); `staffIn(centreId, roleKeys: string[], username?): Promise<{ user, agent }>`; `programManager(): Promise<{ user, agent }>`.

- [ ] **Step 1: Write failing tests** — PM creates centre + manager and the manager can log in and sees it in `/auth/me`; front desk cannot create centre (403); closed centre: its members get 401 on login (if no other centre) and 404 on its routes, reopen restores; doctor in A and B keeps B when A closes; PM resets manager password, but gets 404 for a nurse's id; settings validation (`reminderHours: 0` → 400); chairs/shifts CRUD and `start >= end` → 400.
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS).
- [ ] **Step 5: Commit** `feat: centres, chairs, shifts, settings`

---

### Task 6: Role editing and centre user management

**Files:**
- Create: `server/src/auth/roles.routes.ts`, `server/src/users/routes.ts`
- Test: `server/src/auth/roles.routes.test.ts`, `server/src/users/users.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/roles` (any staff) → all roles; `GET /api/permissions` → catalogue with categories.
  - `POST /api/roles {name, permissions}` and `PATCH /api/roles/:id {name?, permissions?}` (`roles.edit`) — new roles are `scope:'centre'`; the `program_manager` role cannot be edited (403 `system_role_locked`).
  - Centre users (all audited):
    - `GET /api/centres/:c/users` (`users.edit` or `schedule.assignNurses` or `users.create`) → staff with their roles in this centre.
    - `POST /api/centres/:c/users {username, password, name, phone?, roleKeys}` (`users.create`).
    - `PATCH /api/centres/:c/users/:id {name?, phone?, active?, roleKeys?}` (`users.edit`; changing roles also needs `roles.assign`).
    - `POST /api/centres/:c/users/:id/reset-password {password}` (`users.resetPassword`) — target must be a member of this centre or a patient of this centre.
    - `GET /api/centres/:c/users/lookup?phone=` (`users.create`) → `[{id, name}]` of staff users with that exact phone (no centre info).
    - `POST /api/centres/:c/users/:id/link {roleKeys}` (`users.create`) — add membership to this centre.
  - **Grant rule** `assertCanGrant(granterPerms: Set<Permission>, roles: RoleDoc[])`: every permission of every granted role must be in the granter's own permissions for this centre, and no global-scope role can be granted → else 403 `cannot_grant`. Applied in create, patch and link.

- [ ] **Step 1: Write failing tests** — PM adds `sessions.recordUsage` to `front_desk` and a front-desk user's `/auth/me` then includes it (spec example); editing `program_manager` → 403; front desk creates a nurse (201) but creating a `centre_manager` → 403 `cannot_grant`; centre manager assigns `front_desk` to themself → `/auth/me` shows union; nobody can grant `program_manager` via centre routes; lookup by phone + link puts a doctor in two centres; reset password for a user of another centre → 404.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: role editing and centre user management`

---

### Task 7: Patients

**Files:**
- Create: `server/src/patients/patient.model.ts`, `server/src/patients/routes.ts`
- Test: `server/src/patients/patients.test.ts`

**Interfaces:**
- Produces:
  - `Patient { centreId, userId, name, phone, emergencyContact: {name, phone, relation}, kidneyFailureCause, address, socialSituation, financialSituation, otherDiseases, notes, status: 'active'|'transferring'|'discharged', discharge?: { reason: 'transplant'|'death'|'moved'|'travelled'|'left_program', date: string } , createdAt }`. Text fields optional except `name`.
  - `POST /api/centres/:c/patients {...fields, login: {username, password}}` (`patients.create`) → creates `User{kind:'patient'}` + `Patient` in one transaction; 409 `username_taken`.
  - `GET /api/centres/:c/patients?q=&status=` (`patients.view`) — search by name/phone, default `status=active`.
  - `GET /api/centres/:c/patients/:id` (`patients.view`), `PATCH` (`patients.edit`).
  - `loadPatientInCentre(centreId, patientId): Promise<PatientDoc>` — throws 404 if `patient.centreId !== centreId`. **Every later route that takes a patient id uses this.**

- [ ] **Step 1: Write failing tests**
  - create patient → patient can log in, `/auth/me` kind `patient`, no centres;
  - search by phone;
  - **Review Focus 1:** front desk of A `GET /api/centres/A/patients/<B patient id>` → 404, and `PATCH` → 404;
  - nurse PATCH → 403;
  - centre close with an active patient → 409 `has_active_patients` (the test deferred from Task 5).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: patients`

---

### Task 8: Weekly booking, slot grid, shift change and discharge

**Files:**
- Create: `server/src/schedule/pattern.model.ts`, `server/src/schedule/slot.model.ts`, `server/src/schedule/booking.ts`, `server/src/schedule/routes.ts`
- Test: `server/src/schedule/booking.test.ts`

**Interfaces:**
- Consumes: `loadPatientInCentre` (Task 7), `withTransaction`, `recordAudit`.
- Produces:
  - `Pattern { centreId, patientId, chairId, shiftId, weekdays: number[] (1–3 distinct), from: string, to: string|null }`.
  - `Slot { centreId, chairId, shiftId, weekday, patternId }` with **unique index `{chairId, shiftId, weekday}`** — one row per held slot; this index is the race guard.
  - `bookPattern(centreId, input: {patientId, chairId, shiftId, weekdays, from}): Promise<PatternDoc>` — patient must be `active` and have no open pattern (409 `already_booked`); inserts Slot rows in a transaction; duplicate key → 409 `slot_taken`; then calls `regenerateSessions(patientId)` (Task 9; until Task 9 exists, export a no-op stub from `schedule/generate.ts`).
  - `changePattern(centreId, patientId, input: {chairId, shiftId, weekdays, from})` — ends the open pattern at `addDays(from,-1)`, frees its slots, books the new one, all in one transaction; on `slot_taken` the old pattern stays intact.
  - `endPatterns(patientId, lastDate: string, session)` — sets `to`, deletes Slot rows, deletes `scheduled` sessions after `lastDate`. Used by discharge and transfer.
  - Routes (all audited):
    - `GET /api/centres/:c/schedule/grid` (`schedule.view`) → `{ chairs, shifts, slots: [{chairId, shiftId, weekday, patient: {id,name}}] }`.
    - `POST /api/centres/:c/patients/:id/pattern` (`schedule.book`), `PUT` same path = change.
    - `POST /api/centres/:c/patients/:id/discharge {reason, date}` (`patients.discharge`) → `status:'discharged'`, `endPatterns(patientId, date)`.
- Slot freeing is immediate when a change/discharge is recorded (POC simplification, builder's call).

- [ ] **Step 1: Write failing tests**
  - book Sat/Mon/Wed morning chair 1 → grid shows 3 slots;
  - another patient same chair/shift/Mon → 409 `slot_taken`;
  - **Review Focus 2:** `Promise.all` of two bookings for the same slot by two patients → statuses sorted `[201, 409]`;
  - weekdays `[]` or 4 days → 400;
  - change to afternoon from a date → old pattern `to` = day before, old slots free, new slots held;
  - change into a taken slot → 409 and old pattern still open;
  - discharge with reason `transplant` → slots free, status discharged, booking a discharged patient → 409.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: weekly booking, shift change, discharge`

---

### Task 9: Session generation, nurse chair assignments, missed job

**Files:**
- Create: `server/src/sessions/session.model.ts`, `server/src/schedule/generate.ts` (replace stub), `server/src/schedule/assignment.model.ts`, `server/src/notify/jobs.ts`
- Modify: `server/src/schedule/routes.ts`, `server/src/index.ts`
- Test: `server/src/schedule/generate.test.ts`, `server/src/schedule/assignment.test.ts`, `server/src/notify/missed.test.ts`

**Interfaces:**
- Produces:
  - `Session { centreId, patientId, date: string, chairId, shiftId, kind: 'regular'|'makeup', status: 'scheduled'|'active'|'completed'|'postponed'|'missed', openedAt?, openedBy?, closedAt?, closedBy?, vitals: { weightBefore?: number, weightAfter?: number, bp: [{ at: Date, systolic: number, diastolic: number }] }, notes: [{ at: Date, by: ObjectId, text: string }], reminderSentAt?: Date }` with unique index `{patientId, date, shiftId}`.
  - `GENERATION_DAYS = 14`.
  - `regenerateSessions(patientId: string, today?: string): Promise<void>` — for the open pattern, upserts `scheduled` regular sessions for dates in `[max(today, pattern.from), today+13]` on matching weekdays (and ≤ `pattern.to` if set); never touches non-`scheduled` sessions.
  - `generateAll(today?: string)` — runs `regenerateSessions` for every open pattern; scheduled daily at 00:05 `APP_TZ` and at boot.
  - `markMissed(now?: Date): Promise<number>` — `scheduled` sessions with `date < todayLocal(now)` → `missed`; cron hourly.
  - `ChairAssignment { centreId, shiftId, chairId, nurseId }` unique `{chairId, shiftId}`.
  - `PUT /api/centres/:c/assignments {shiftId, nurseId, chairIds}` (`schedule.assignNurses`) — sets this nurse on those chairs for that shift (replacing previous occupants); `GET /api/centres/:c/assignments` (`schedule.view`). Nurse must hold the `nurse` role in the centre (400 `not_a_nurse`).
  - `GET /api/centres/:c/today?date=` (`sessions.view`) → `{ mine: SessionCard[], unassigned: SessionCard[], others: SessionCard[] }` where `mine` = sessions on chairs assigned to the caller for that session's shift, `unassigned` = sessions on chairs with no assignment, `others` = the rest. `SessionCard = { id, date, status, kind, chair: {id,label}, shift: {id,name,start,end}, patient: {id,name}, hasActiveOrders: boolean }` (`hasActiveOrders` false until Task 13).

- [ ] **Step 1: Write failing tests**
  - booking Sat/Mon/Wed from 2026-10-17 with today 2026-10-17 → 6 sessions in 14 days, all on those weekdays;
  - regenerate twice → no duplicates;
  - change pattern → future scheduled sessions follow new pattern, past/completed untouched;
  - assignment: nurse X chairs 1–2 morning, nurse Y chairs 1–2 afternoon → X's `mine` has only morning sessions; chair 3 sessions show in `unassigned`;
  - **Review Focus 4:** `markMissed(new Date('2026-10-18T20:30:00Z'))` (23:30 Damascus) marks a scheduled session dated 2026-10-17 as missed but leaves 2026-10-18 scheduled; `markMissed(new Date('2026-10-18T21:30:00Z'))` (00:30 next day) marks 2026-10-18 too.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: session generation, nurse assignments, missed job`

---

### Task 10: Units and the medicine & supply list

**Files:**
- Create: `server/src/catalog/unit.model.ts`, `server/src/catalog/item.model.ts`, `server/src/catalog/routes.ts`, `server/src/catalog/merge.ts`
- Test: `server/src/catalog/catalog.test.ts`

**Interfaces:**
- Produces:
  - `Unit { name (unique, case-insensitive) }`; `Item { name, type: 'medicine'|'supply', unitId, status: 'approved'|'pending'|'retired', createdBy, mergedInto?: ObjectId, used: boolean }`.
  - `GET /api/catalog/units`, `POST /api/catalog/units {name}` (`catalog.add` in any centre or `catalog.manage`) — existing name (case-insensitive) returns the existing unit, 200.
  - `GET /api/catalog/items?type=&q=&status=` (`catalog.view` in any centre or `catalog.manage`) — default excludes `retired`; pending items are returned (usable immediately) with `status`.
  - `POST /api/catalog/items {name, type, unitId}` — `catalog.manage` → `approved`; `catalog.add` → `pending`.
  - `PATCH /api/catalog/items/:id {name?, type?, unitId?, status?}` (`catalog.manage`) — changing `unitId` when `used` → 409 `unit_locked`.
  - `POST /api/catalog/items/:id/merge {intoId}` (`catalog.manage`) → `mergeItems(fromId, intoId)`: same `unitId` required else 400 `unit_mismatch`; in one transaction re-point all `UsageLine.itemId` (model from Task 11; create the model file here with `{ sessionId, centreId, patientId, date, itemId, amount, by }`) from → into, set from `status:'retired', mergedInto: intoId`, set into `used` if from was used.
  - `markItemUsed(itemId, session?)` — sets `used: true` (called by Task 11).
  - "Any centre" check helper `hasPermAnywhere(user, perm)` in `auth/effective.ts`.

- [ ] **Step 1: Write failing tests**
  - nurse adds "Heparine" → pending, visible in list;
  - PM approves; front desk cannot PATCH (403);
  - unit add is case-insensitive dedupe;
  - **Review Focus 5 (part):** two UsageLines on pending "Heparine" (cc), merge into "Heparin" (cc) → lines point to Heparin, Heparine retired; merge "Heparin IU" into "Heparin cc" → 400 `unit_mismatch`;
  - unit change on used item → 409 `unit_locked`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: medicine and supply list with units and merge`

---

### Task 11: Running a session (open, usage, vitals, notes, close, postpone, make-up)

**Files:**
- Create: `server/src/sessions/usage.model.ts` (move from Task 10 if placed elsewhere), `server/src/sessions/service.ts`, `server/src/sessions/routes.ts`
- Test: `server/src/sessions/sessions.test.ts`

**Interfaces:**
- Consumes: `Session` (Task 9), `Item`, `markItemUsed` (Task 10), `loadPatientInCentre`.
- Produces (all under `/api/centres/:c/sessions/:sid`, session must have `centreId === :c` else 404, all audited):
  - `GET` (`sessions.view`) → `SessionDetail = SessionCard + { vitals, notes: [{at, by:{id,name}, text}], usage: [{id, item:{id,name,type,unit}, amount, by, at}], orders: OrderDto[] }` (`orders` empty until Task 13).
  - `POST /open` (`sessions.run`) — only from `scheduled`, and only when `date === todayLocal()` → `active`, `openedAt/By` (409 `bad_status`, 409 `not_today`).
  - `POST /usage {itemId, amount > 0}` (`sessions.recordUsage`) — session `active` (or `completed`, see Task 12); item not `retired`; creates `UsageLine` copying `centreId, patientId, date`; `markItemUsed`.
  - `DELETE /usage/:lineId` (`sessions.recordUsage`).
  - `PATCH /vitals {weightBefore?, weightAfter?}` and `POST /vitals/bp {systolic, diastolic}` (`sessions.recordVitals`).
  - `POST /notes {text}` (`sessions.addNotes`).
  - `POST /close` (`sessions.run`) — from `active` → `completed`. **No server-side heparin rule** (the warning is client-side, Task 23).
  - `POST /postpone` (`sessions.postpone`) — from `scheduled` or `missed` → `postponed`.
  - `POST /api/centres/:c/patients/:id/makeup {date, chairId, shiftId}` (`schedule.makeup`) — `date` within `today .. today+3`; creates `kind:'makeup'` `scheduled` session; 409 `slot_busy` if another non-postponed session exists for that chair/shift/date or that chair/shift's weekday slot is held by another patient's pattern on that date.
- Usage/vitals/notes on a `scheduled|postponed|missed` session → 409 `bad_status`.

- [ ] **Step 1: Write failing tests**
  - full run: open → usage Heparin 5 cc → BP → note → close → GET shows all;
  - **Review Focus 1:** nurse of A `GET /api/centres/A/sessions/<B session id>` → 404;
  - open a session dated tomorrow → 409 `not_today`;
  - front desk without `sessions.recordUsage` → 403; after PM adds it to `front_desk` → 201 (spec example);
  - close without any heparin → 200;
  - postpone then make-up in 2 days on a free chair → new scheduled makeup session; make-up 5 days out → 400; make-up onto a held slot → 409.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: run sessions`

---

### Task 12: Editing closed sessions with change history

**Files:**
- Create: `server/src/sessions/change.model.ts`
- Modify: `server/src/sessions/service.ts`, `server/src/sessions/routes.ts`
- Test: `server/src/sessions/history.test.ts`

**Interfaces:**
- Produces:
  - `SessionChange { sessionId, at, by, kind: 'usage.add'|'usage.update'|'usage.remove'|'note.add'|'note.update'|'note.remove'|'vitals.update', before: object|null, after: object|null }`.
  - On a `completed` session, the Task 11 write routes require `sessions.editClosed` **in addition** to their normal permission and write a `SessionChange`. New routes: `PATCH /usage/:lineId {amount}`, `PATCH /notes/:noteId {text}`, `DELETE /notes/:noteId` (allowed on `active` without history, on `completed` with history).
  - `GET /api/centres/:c/sessions/:sid/history` (`sessions.viewHistory`) → changes newest first with `by: {id,name}`.

- [ ] **Step 1: Write failing tests** — after close: nurse changes heparin 5→1 → history has `usage.update` with before `{amount:5}` after `{amount:1}`; removes a supply → `usage.remove`; doctor (no `editClosed`) PATCH → 403 but can read history; front desk reading history → 403; edits while `active` create no history.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: closed-session edits with change history`

---

### Task 13: Doctor orders

**Files:**
- Create: `server/src/orders/order.model.ts`, `server/src/orders/routes.ts`
- Modify: `server/src/sessions/service.ts` (include orders), `server/src/schedule/routes.ts` (`hasActiveOrders`)
- Test: `server/src/orders/orders.test.ts`

**Interfaces:**
- Produces:
  - `Order { patientId, centreId, doctorId, text, from: string, status: 'active'|'ended', endedAt? }`; `OrderDto = { id, text, from, status, doctor: {id,name}, createdAt }`.
  - `GET /api/centres/:c/patients/:id/orders?status=` (`orders.view`), `POST {text, from?=today}` (`orders.write`), `POST .../orders/:oid/end` (`orders.write`).
  - `activeOrdersFor(patientId, date): Promise<OrderDto[]>` — `status:'active'` and `from <= date`; used by session `GET` and `hasActiveOrders`.
  - `GET /api/centres/:c/patients/:id/sessions?before=&limit=20` (`sessions.view`) → patient's sessions newest first (only those with `centreId === :c` **or** any centre if the patient currently belongs to `:c` — i.e., full history follows the patient) with usage and notes; used by doctor and front desk.

- [ ] **Step 1: Write failing tests** — doctor writes "heparin-free" → nurse sees it on today's session detail and `hasActiveOrders: true`; ended order disappears; nurse POST order → 403; session runs fine with no orders; doctor linked to A and B lists orders in both via each centre route.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: doctor orders and patient history`

---

### Task 14: Transfers between centres

**Files:**
- Create: `server/src/transfers/transfer.model.ts`, `server/src/transfers/service.ts`, `server/src/transfers/routes.ts`
- Test: `server/src/transfers/transfers.test.ts`

**Interfaces:**
- Consumes: `endPatterns` (Task 8), `loadPatientInCentre`.
- Produces:
  - `Transfer { patientId, fromCentreId, toCentreId, status: 'pending'|'accepted'|'rejected'|'cancelled', note?, rejectReason?, sentBy, sentAt, decidedBy?, decidedAt? }`.
  - `GET /api/centres/:c/transfer-targets` (`transfers.send`) → `[{id,name}]` of active centres other than `:c` (names only).
  - `POST /api/centres/:c/patients/:id/transfer {toCentreId, note?}` (`transfers.send`) → patient `status:'transferring'` (stays fully in old centre); 409 if already pending.
  - `POST /api/centres/:c/transfers/:tid/cancel` (`transfers.send`, from-centre only).
  - `GET /api/centres/:c/transfers?direction=incoming|outgoing` (`transfers.send` or `transfers.decide`) — incoming shows patient summary `{name, phone, kidneyFailureCause}` so the receiving desk can decide.
  - `POST /api/centres/:c/transfers/:tid/accept` (`transfers.decide`, to-centre only) — transaction: `endPatterns(patientId, today)`, patient `centreId = to`, `status:'active'`; active orders keep `status` but `centreId = to`.
  - `POST /api/centres/:c/transfers/:tid/reject {reason}` → patient back to `active` in old centre.

- [ ] **Step 1: Write failing tests**
  - send → old centre still reads patient, new centre cannot (404) until accept;
  - accept → **Review Focus 3:** old front desk 404 on patient; a doctor linked only to old centre 404; new centre sees full history (sessions held in old centre included) via Task 13 history route; slots in old centre freed;
  - reject with reason → patient active in old centre, reason visible in outgoing list;
  - accept by from-centre → 404.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: transfers between centres`

---

### Task 15: Reports (program manager dashboard and centre stats)

**Files:**
- Create: `server/src/reports/stats.ts`, `server/src/reports/routes.ts`
- Test: `server/src/reports/stats.test.ts`

**Interfaces:**
- Produces:
  - `centreStats(centreIds: ObjectId[], month: 'YYYY-MM'): Promise<CentreStats[]>` — aggregation pipelines over `Session` and `UsageLine` by **session's `centreId`**:
    `CentreStats = { centre: {id, name}, sessions: number /* completed */, patients: number /* distinct patients with ≥1 completed session */, medicines: ItemTotal[], supplies: ItemTotal[] }`, `ItemTotal = { item: {id,name}, unit: string, total: number }` sorted by name. Usage on retired items is resolved through `mergedInto` (defensive; merge already re-points).
  - `GET /api/stats?month=` (`stats.global`) → all centres including closed.
  - `GET /api/centres/:c/stats?month=` (`reports.centre`).

- [ ] **Step 1: Write failing tests**
  - two centres, completed/missed/postponed sessions → `sessions` counts completed only; patients distinct;
  - medicine totals in unit; usage edited after close (Task 12) changes totals;
  - **Review Focus 5:** after merge the surviving item total = sum of both;
  - **Review Focus 3:** after transfer, old centre's month still counts its sessions; response contains no patient names (assert JSON string doesn't include the patient's name);
  - nurse → 403 on `/api/stats`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: reports`

---

### Task 16: Patient endpoints

**Files:**
- Create: `server/src/me/routes.ts`
- Test: `server/src/me/me.test.ts`

**Interfaces:**
- Produces (all `requirePatient`, scoped to the caller's own `Patient`):
  - `GET /api/me/overview` → `{ patient: {name}, centre: {name}, active: SessionMini|null, upcoming: SessionMini[] /* next 14 days, scheduled */ }`, `SessionMini = { id, date, start, end, centreName, kind, status }`.
  - `GET /api/me/sessions?before=&limit=20` → past sessions newest first with `usage: [{name, amount, unit}]`, plus `notes` and `orders` **only when** the patient's current centre has `settings.patientsSeeNotes = true` (otherwise those keys are absent).
- [ ] **Step 1: Write failing tests** — upcoming list; active session appears after nurse opens; medicines visible; notes absent when setting off, present when on; a patient can't fetch another patient's session (`/api/me/sessions` only returns own; staff routes → 403).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: patient endpoints`

---

### Task 17: Push notifications and session reminders

**Files:**
- Create: `server/src/notify/subscription.model.ts`, `server/src/notify/push.ts`, `server/src/notify/routes.ts`
- Modify: `server/src/notify/jobs.ts`, `server/src/index.ts`
- Test: `server/src/notify/reminders.test.ts`

**Interfaces:**
- Produces:
  - `PushSubscription { userId, endpoint (unique), keys: {p256dh, auth} }`.
  - `GET /api/push/key` → `{ publicKey }`; `POST /api/push/subscribe {endpoint, keys}`; `POST /api/push/unsubscribe {endpoint}` (any logged-in user).
  - `sendPush(userId, payload: {title, body, url}): Promise<void>` — `web-push`; deletes subscriptions that return 404/410.
  - `sendDueReminders(now?: Date, send = sendPush): Promise<number>` — for `scheduled` sessions where `localDateTime(date, shift.start) - centre.settings.reminderHours h <= now < localDateTime(date, shift.start)` and `reminderSentAt` unset: send `{title:'Dialysis session', body:'<weekday> <date> at <start>, chair <label>', url:'/me'}` to the patient's user, set `reminderSentAt`. Cron every 10 minutes.
  - Text goes through a server-side `en` message map (`server/src/notify/messages.ts`) so Arabic can be added later.
- [ ] **Step 1: Write failing tests** (inject fake `send`) — session tomorrow 07:00 with `reminderHours 24`: at today 06:50 → not due; at 07:05 → sent once; second run → 0; centre with 15h → due at 16:00 previous day; postponed session → never sent.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: push subscriptions and session reminders`

---

### Task 18: Demo seed script

**Files:**
- Create: `server/src/seed/demo.ts`; script `npm run seed:demo -w server`

**Interfaces:**
- Produces an idempotent script (refuses unless `ALLOW_DEMO_SEED=1`) that creates: roles; program manager `pm / demo1234`; 2 centres each with manager, front desk, 2 nurses, 1 doctor (the doctor linked to both centres), 8 chairs, Morning/Afternoon shifts; units `cc, ml, IU, mg, piece`; approved items: Heparin (cc), EPO (IU), Iron sucrose (mg), Vitamin B complex (ml), Dialyser (piece), Bloodline set (piece), AV fistula needle (piece), Acid concentrate (piece), Bicarbonate cartridge (piece); 10 patients per centre with patterns and nurse assignments; a few completed sessions in the past 2 weeks with usage.
- [ ] **Step 1:** Write the script; **Step 2:** run against a local Mongo (`docker run -d -p 27017:27017 mongo:7 --replSet rs0` then `rs.initiate()`), then `npm run seed:demo -w server` twice — Expected: second run reports "already seeded", counts unchanged.
- [ ] **Step 3: Commit** `chore: demo seed`

---

## Part B — Client

Client conventions (apply to every client task): TanStack Query hooks per feature in `features/<x>/api.ts` using `client/src/api.ts` (`apiGet/apiPost/apiPatch/apiPut/apiDelete`, `credentials:'include'`, throws `ApiError{status, code}`); every string via `t('…')`; Mantine components; mobile-first layouts; permission checks via `useCan(perm, centreId?)`. Tests: Vitest + RTL + MSW in `client/src/**/*.test.tsx`.

### Task 19: Client shell — login, centre switcher, role-aware navigation, i18n, PWA

**Files:**
- Create: `client/package.json`, `client/vite.config.ts` (with `vite-plugin-pwa`, dev proxy `/api` → `http://localhost:3000`), `client/index.html`, `client/public/icons/*`
- Create: `client/src/{main.tsx,App.tsx,api.ts,theme.ts}`, `client/src/i18n/{index.ts,en.json}`, `client/src/auth/{AuthProvider.tsx,useCan.ts,LoginPage.tsx}`, `client/src/layout/{AppShell.tsx,nav.ts}`
- Test: `client/src/layout/nav.test.tsx`, `client/src/auth/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `MeDto`, `Permission` from `shared`.
- Produces:
  - `useAuth(): { me: MeDto|null, login(u,p), logout() }`; `useCentre(): { centreId, setCentreId }` (remembered in `localStorage` inside try/catch; defaults to first centre); `useCan(perm, centreId?): boolean`.
  - `NAV_ITEMS: { path, labelKey, perm: Permission | 'patient' }[]` and `visibleNav(me, centreId)` — routes:
    `/centres` (`centres.create`), `/roles` (`roles.edit`), `/catalog` (`catalog.manage`), `/dashboard` (`stats.global`), `/c/:centreId/today` (`sessions.run`), `/c/:centreId/patients` (`patients.view`), `/c/:centreId/schedule` (`schedule.view`), `/c/:centreId/transfers` (`transfers.send` | `transfers.decide`), `/c/:centreId/users` (`users.create`), `/c/:centreId/setup` (`schedule.setup`), `/c/:centreId/settings` (`settings.centre`), `/c/:centreId/audit` (`audit.view`), `/c/:centreId/stats` (`reports.centre`), `/me` (patient).
  - Phone layout: bottom tab bar with the first 4 visible items + "More"; desktop: side nav. Centre switcher at the top when the user has > 1 centre.
  - After login, redirect: patient → `/me`; nurse-like (`sessions.run`) → `today`; else first visible nav item.
  - PWA manifest: `name: "Dialysis Centre"`, `display: standalone`, `start_url: "/"`, neutral theme colour from `theme.ts`; service worker `injectManifest` strategy (custom `client/src/sw.ts` handling `push` and `notificationclick`, used in Task 25).
  - `theme.ts`: Mantine theme with neutral palette + `danger`/`warning` colours for alerts; font `system-ui`.
- [ ] **Step 1: Write failing tests** — `visibleNav` for nurse contains `today` but not `users`; front desk with `sessions.recordUsage` added doesn't gain `today` (needs `sessions.run`); patient sees only `/me`; LoginPage shows translated error on 401 (MSW).
- [ ] **Step 2–4:** FAIL → implement → PASS (`npm test -w client`).
- [ ] **Step 5: Manual check** — `npm run dev`, log in as `pm` from demo seed, Chrome devtools at 360 px: nav usable, Lighthouse shows "Installable".
- [ ] **Step 6: Commit** `feat(client): shell, login, navigation, PWA`

### Task 20: Program manager screens

**Files:** `client/src/features/pm/{CentresPage,CentreForm,RolesPage,RoleEditor,CatalogPage,MergeDialog,DashboardPage,api}.tsx|ts`; Test: `client/src/features/pm/RoleEditor.test.tsx`

**Interfaces:**
- Consumes: Task 5, 6, 10, 15 endpoints.
- Produces:
  - Centres: list with status, create (centre + manager credentials), close (shows `has_active_patients` message), reopen, manager password reset.
  - Roles: list; editor with permissions grouped by `CATEGORIES` as checkbox groups; global permissions hidden for centre roles; `program_manager` read-only.
  - Catalog: tabs Medicines/Supplies, "Pending review" filter with badge count; approve, edit (unit select disabled when `used`), merge dialog listing only same-unit items; units add.
  - Dashboard: month picker (default current month), card per centre: sessions, patients, and two compact tables (item, total, unit).
- [ ] **Step 1: Failing test** — RoleEditor renders categories, ticking "Record medicines and supplies" sends `PATCH /api/roles/:id` with that permission added (MSW captures body).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Manual check at 360 px** — create centre, approve and merge a pending item, see dashboard.
- [ ] **Step 6: Commit** `feat(client): program manager screens`

### Task 21: Centre manager screens

**Files:** `client/src/features/centre/{UsersPage,UserForm,SetupPage,SettingsPage,AuditPage,CentreStatsPage,api}.tsx|ts`; Test: `client/src/features/centre/UserForm.test.tsx`

**Interfaces:**
- Produces: users list + create/edit (role multi-select from `/api/roles` minus global), link existing doctor by phone lookup, reset password; chairs & shifts setup; settings (patients see notes switch, reminder hours number 1–72); audit list with user filter; centre stats (reuse dashboard card component from Task 20 — extract to `client/src/components/StatsCard.tsx`).
- [ ] **Step 1: Failing test** — UserForm: server 403 `cannot_grant` shows translated message; phone lookup shows found doctor and "Link" sends `POST .../link`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(client): centre manager screens`

### Task 22: Front desk screens — patients, schedule, transfers

**Files:** `client/src/features/desk/{PatientsPage,PatientForm,PatientPage,ScheduleGrid,BookDialog,AssignNursesPage,MakeupDialog,DischargeDialog,TransfersPage,api}.tsx|ts`; Test: `client/src/features/desk/ScheduleGrid.test.tsx`

**Interfaces:**
- Produces:
  - Patients: search list; create form (record fields + login username/password); patient page with record, current pattern, history (Task 13 route), orders (read), actions: book/change pattern, postpone + make-up, discharge (reason select), transfer (target centre select + note), reset patient password.
  - Schedule grid: on phone, pick shift then weekday → list of chairs with patient or "Free"; on desktop, chairs × weekdays table per shift. Tapping a free slot opens BookDialog prefilled.
  - Assign nurses: per shift, nurse select per chair.
  - Transfers: incoming (accept / reject with reason) and outgoing (status, cancel).
- [ ] **Step 1: Failing test** — ScheduleGrid with MSW grid data renders "Free" for empty chair 3 Monday morning and the patient name for chair 1; tapping Free opens BookDialog with chair 3/Morning/Mon preselected; booking 409 `slot_taken` shows translated message and refetches grid.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(client): front desk screens`

### Task 23: Nurse screens — today and the session

**Files:** `client/src/features/nurse/{TodayPage,SessionPage,UsagePicker,AddItemDialog,VitalsForm,NotesList,HistoryDrawer,api}.tsx|ts`; Test: `client/src/features/nurse/SessionPage.test.tsx`

**Interfaces:**
- Produces:
  - Today: sections "My chairs", "Unassigned", "Other chairs" (collapsed); card shows chair, shift, patient, status chip, orders badge.
  - Session page (the most important screen, one column, big buttons): orders banner (only if any); big "Open session" (only if `scheduled` and today); once active: usage list + "Add medicine/supply" (searchable picker by name, type tabs, amount input with unit suffix, quick recent items: Heparin first), "Add missing item" (name, type, unit select with add-unit), vitals (weight before/after, BP readings list + add), notes (timed list + add), "Close session". Completed: same view; edit actions visible only with `sessions.editClosed`; "Change history" drawer with `sessions.viewHistory`. Postpone button for `scheduled`.
  - **Close warning:** if no usage line has an item named `Heparin` (case-insensitive match on the approved item name) show confirm "No heparin recorded. Close anyway?" with "Close anyway" / "Go back"; never blocks.
- [ ] **Step 1: Failing tests** — close with no heparin shows confirm and "Close anyway" sends `POST /close`; with heparin line closes directly; doctor order text visible in banner; edit buttons hidden on completed session without `sessions.editClosed`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Manual check at 360 px** — run a full session from the demo seed with only thumbs.
- [ ] **Step 6: Commit** `feat(client): nurse screens`

### Task 24: Doctor screens

**Files:** `client/src/features/doctor/{DoctorPatientsPage,DoctorPatientPage,OrderForm,api}.tsx|ts`; Test: `client/src/features/doctor/OrderForm.test.tsx`

**Interfaces:**
- Produces: centre switcher (Task 19) at top; patient list; patient page: active orders (write new free-text order, end order), session history (date, chair, usage, vitals, notes, change history link). Reuses `PatientPage` history component from Task 22 (extract to `client/src/components/SessionHistory.tsx`).
- [ ] **Step 1: Failing test** — submitting "Heparin-free until further notice" posts the order and it appears in active list; "End" removes it.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(client): doctor screens`

### Task 25: Patient screens, install prompt and notifications

**Files:** `client/src/features/patient/{MePage,HistoryPage,InstallPrompt,useNotifications}.tsx|ts`, `client/src/sw.ts`; Test: `client/src/features/patient/MePage.test.tsx`

**Interfaces:**
- Consumes: Task 16, 17 endpoints.
- Produces:
  - Me: "Session active now" banner when `active`; upcoming list (weekday, date, time, centre); link to history (per session: medicines with amount + unit; notes/orders only if returned).
  - InstallPrompt: Android → uses `beforeinstallprompt`; iOS Safari not standalone → short instructions "Tap Share, then Add to Home Screen"; hidden when already standalone.
  - `useNotifications()`: asks permission on a button tap (never on load), subscribes with `/api/push/key`, posts to `/api/push/subscribe`.
  - `sw.ts`: precache, `push` → `showNotification(title, {body, data:{url}})`, `notificationclick` → focus/open `url`.
- [ ] **Step 1: Failing test** — MePage shows active banner when overview has `active`; history hides notes section when `notes` key absent.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Manual check** — on an Android phone over HTTPS (Task 26 deployment or a tunnel): install, enable notifications, trigger `sendDueReminders` by seeding a session within the window → notification arrives.
- [ ] **Step 6: Commit** `feat(client): patient screens and notifications`

---

## Part C — End to end and deployment

### Task 26: Core-flow E2E test and VPS deployment

**Files:**
- Create: `e2e/core-flow.spec.ts`, `playwright.config.ts` (mobile viewport `Pixel 7`), `server/src/seed/e2e.ts` (minimal: roles, pm, one centre with manager/front desk/nurse/doctor, 4 chairs, 2 shifts, Heparin & EPO items)
- Create: `deploy/docker-compose.yml` (services `mongo:7` with `--replSet rs0` + init healthcheck, `app` = Node serving API and built client from `client/dist`, `caddy` for HTTPS), `deploy/Caddyfile`, `deploy/README.md` (env vars incl. generating VAPID keys with `npx web-push generate-vapid-keys`, first-run steps, `seed:demo`)
- Modify: `server/src/app.ts` — in production serve `client/dist` with SPA fallback.

**Interfaces:**
- Consumes everything.

- [ ] **Step 1: Write the E2E test** (the client's success criterion, spec §1):
  1. front desk creates patient "Test Patient" with login → books a pattern whose weekdays include **today's weekday**, from today, → assigns nurse to that chair/shift;
  2. doctor writes order "Give EPO 4000 IU";
  3. nurse sees the session under "My chairs", sees the order, opens, adds Heparin 5 cc and EPO 4000 IU, BP 120/80, note "Stable", closes (heparin present → no warning);
  4. doctor sees the session in history with the note;
  5. patient logs in, sees the session with Heparin 5 cc;
  6. program manager dashboard for this month shows 1 session, 1 patient, Heparin 5 cc.
- [ ] **Step 2: Run** `npx playwright test` against `npm run dev` with e2e seed — Expected: PASS (fix any defects found in earlier tasks, each with a regression test in the owning task's test file).
- [ ] **Step 3: Deployment dry run** — `docker compose -f deploy/docker-compose.yml up -d --build` locally, `curl -k https://localhost/api/health` → `{"ok":true}`.
- [ ] **Step 4: Commit** `test: core-flow e2e; chore: VPS deployment`

---

## Spec coverage map

| Spec section | Tasks |
| --- | --- |
| 2 Constraints (stack, PWA, phone-first, i18n, Mongo usage) | 1, 19, 25, 26 |
| 3 Dynamic roles, catalogue, scope rules, defaults | 2, 3, 6 |
| 4 Entities | 3–17 |
| 5.1 Program manager centres, reset manager password | 5, 20 |
| 5.2 Centre setup, settings, audit | 4, 5, 21 |
| 5.3 Front desk patients & staff, multi-centre doctor | 6, 7, 22 |
| 5.4 Schedule, shift change, make-up, discharge | 8, 9, 11, 22 |
| 5.5 Doctor orders | 13, 24 |
| 5.6 Nurse session, heparin warning, fixing mistakes | 11, 12, 23 |
| 5.7 Transfers | 14, 22 |
| 5.8 Medicine & supply list, units, merge | 10, 20 |
| 5.9 Dashboard, transfer reporting rule | 15, 20, 21 |
| 5.10 Patient, reminders, install prompt | 16, 17, 25 |
| Demo / deployment | 18, 26 |
