# Scheduling v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the POC's fixed weekly pattern with a front-desk-built calendar: schedule setup (machines, session blocks, working days), a dated nurse roster, per-day patient bookings (one-off or weekly), a shared Today board, and one patient timeline — while keeping everything else built on `main` working.

**Architecture:** Server changes live in `server/src/schedule/` (setup, plans, slots, roster, generation, board, timeline) and `server/src/sessions/` (statuses, snapshots). `Pattern`, `Slot` and `ChairAssignment` are replaced by `Plan` and `RosterEntry`; a single slot-availability service is the only place "free" is decided. Client screens are rebuilt in `client/src/features/desk/` (setup, calendar, roster, booking), a shared `client/src/features/board/` (Today board) and a shared `client/src/components/Timeline.tsx`.

**Tech Stack:** unchanged — Node ≥ 22, TypeScript strict, Express 5, Mongoose 8 (replica set), zod, luxon; React 18, Vite 8, Mantine 7, TanStack Query 5, react-i18next; Vitest 4, supertest, mongodb-memory-server, RTL + MSW; Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-scheduling-v2-design.md` (binding; §10a holds the settled rules). The POC spec `docs/superpowers/specs/2026-10-18-dialysis-poc-design.md` still governs everything this one doesn't change.

## Global Constraints

- All POC global constraints still apply (centre-scoped routes `/api/centres/:centreId/...` with `requirePerm`, 404 across centres, JSON errors, transactions for multi-document writes, i18n for every string, logical CSS, phone-first ≥ 44 px targets, dates `YYYY-MM-DD` in `APP_TZ`, weekdays `0=Sunday … 6=Saturday`, times `HH:mm`).
- Slot = machine × session block × date. Taken if a session with status `scheduled|active|completed` exists for it, or an open weekly plan item covers it (same weekday, `from ≤ date ≤ to|∞`) — unless that plan's own session for that date is `postponed|cancelled` or was moved (detached). Only `schedule/slots.ts` decides this.
- Session statuses: `scheduled`, `active`, `completed`, `postponed`, `missed`, `did_not_come`, `cancelled`. No "arrived".
- Roster precedence per machine: shorter date span wins; then specific machines over all machines; then most recently created.
- Past/final sessions never change when setup or roster changes; future `scheduled` sessions are refreshed.
- Default `front_desk` role gains `schedule.setup`, `sessions.run`, `sessions.recordUsage`, `sessions.recordVitals`, `sessions.addNotes` (seed + migration, additive).
- Did-not-come and cancel use permission `sessions.postpone` (label becomes "Postpone, cancel, did not come").
- Today board polls every 30 s.
- No centre-wide log, look-back calendar, leave management or non-weekly recurrence.

## Review Focus

1. **Booking a weekly plan into a slot that a different patient holds only beyond the 14-day generation window** (no session exists yet): must be refused `slot_taken`, not accepted. Test in Task 3.
2. **A one-off/move/make-up onto a slot freed only for that date** (holder's session postponed/cancelled/moved): allowed on that date, refused on the holder's other dates. Test in Task 3.
3. **Editing a roster after a missed/did-not-come session**: the past session still shows the nurse that was rostered at the time. Test in Task 6.
4. **Changing the weekly plan from a date while a moved (detached) future session exists**: the moved session survives untouched and the old weekday's future sessions are removed. Test in Task 4.
5. **Today board at a block boundary (12:00 exactly) and on a non-working day**: board defaults to the block whose `start ≤ now < end` (else the next block, else the last), and a non-working day shows "Centre closed today" with no slots. Test in Task 8.

---

## File Structure

```
server/src/centres/centre.model.ts        + workingDays: number[]
server/src/schedule/setup.ts               schedule setup service (machines, blocks, working days)
server/src/schedule/setup.routes.ts        GET/PUT /schedule/setup
server/src/schedule/plan.model.ts          Plan {items[], from, to, repeat} (replaces pattern.model.ts)
server/src/schedule/slots.ts               isSlotFree / freeMachines / assertSlotFree (single source of truth)
server/src/schedule/booking.ts             bookPlan / changePlan / endPlans / bookOnce (rewritten)
server/src/schedule/generate.ts            generation from plans + snapshots + refreshFutureSessions
server/src/schedule/roster.model.ts        RosterEntry (replaces assignment.model.ts)
server/src/schedule/roster.ts              resolveRoster(centreId, date) + routes helpers
server/src/schedule/roster.routes.ts       roster CRUD
server/src/schedule/board.ts               Today board builder
server/src/schedule/routes.ts              grid → calendar, plan routes, free, board (rewritten)
server/src/sessions/session.model.ts       + statuses, snapshots, runBy, rosterNurseId, planId, detached
server/src/sessions/service.ts             + didNotCome, cancel, moveSession, finalise snapshot
server/src/sessions/timeline.ts            buildTimeline(patientId, viewer) shared by staff and /me
server/src/notes/patient-note.model.ts     doctor patient notes
server/src/notes/routes.ts
server/src/seed/migrate-v2.ts              idempotent migration + CLI
client/src/features/desk/SetupPage.tsx     schedule setup (moved from centre/)
client/src/features/desk/CalendarPage.tsx  week/day calendar (replaces ScheduleGrid)
client/src/features/desk/RosterPage.tsx    roster (replaces AssignNursesPage)
client/src/features/desk/BookDialog.tsx    per-day rows (rewritten)
client/src/features/board/BoardPage.tsx    shared Today board (replaces nurse TodayPage)
client/src/components/Timeline.tsx         shared patient timeline (replaces SessionHistory.tsx)
```

Deleted at the end of their tasks: `schedule/pattern.model.ts`, `schedule/slot.model.ts`, `schedule/assignment.model.ts`, `client/src/features/desk/ScheduleGrid.tsx`, `AssignNursesPage.tsx`, `client/src/features/nurse/TodayPage.tsx`, `client/src/components/SessionHistory.tsx`, `client/src/features/patient/HistoryPage.tsx` (each replaced; their tests are rewritten against the replacement).

---

## Part A — Server

### Task 1: Schedule setup (machines, session blocks, working days)

**Files:** Modify `server/src/centres/centre.model.ts`, `server/src/auth/roles.seed.ts`, `shared/src/permissions.ts` (label only), `server/src/app.ts` (mount); Create `server/src/schedule/setup.ts`, `server/src/schedule/setup.routes.ts`; Test `server/src/schedule/setup.test.ts`.

**Interfaces:**
- Produces:
  - `Centre.workingDays: number[]` (default `[0,1,2,3,4,6]` — Sat–Thu, Friday off).
  - `SetupDto = { machines: {id,label,active}[], blocks: {id,name,start,end}[], workingDays: number[] }`.
  - `GET /api/centres/:c/schedule/setup` (`schedule.view`) → SetupDto (active only).
  - `PUT /api/centres/:c/schedule/setup {machineCount: 1..100, blocks: {id?, name, start, end}[] (1..6), workingDays: number[] (1..7)}` (`schedule.setup`) → SetupDto. Audited `schedule.setup`.
  - `proposeBlocks(dayStart, dayEnd, count): {name,start,end}[]` exported pure helper (names "Session 1…N", equal split rounded down to the minute; last block ends at dayEnd). Client calls the same logic — duplicate it client-side in Task 11 (pure, 10 lines).
  - Rules (409 `in_use` when violated): removing a block or retiring a machine (count lowered → highest-numbered retired), or removing a working day, while any open plan item references it or any `scheduled` session ≥ today uses it. Blocks must not overlap and `start < end` (400 `blocks_overlap` / `validation`). Raising count creates/reactivates machines labelled with the next numbers.
  - Changing an existing block's times calls `refreshFutureSessions(centreId)` (from Task 5; until then export a no-op stub from `generate.ts`).
- Default `front_desk` role gains `schedule.setup`, `sessions.run`, `sessions.recordUsage`, `sessions.recordVitals`, `sessions.addNotes`.

- [ ] **Step 1: Failing tests** — `proposeBlocks('08:00','16:00',2)` → `[{Session 1,08:00,12:00},{Session 2,12:00,16:00}]`; `proposeBlocks('08:00','17:00',2)` → 08:00–12:30, 12:30–17:00; PUT with 8 machines/2 blocks/Sat–Thu then GET returns 8 machines labelled "1".."8"; lowering to 6 while machine 7 has an open plan item → 409 `in_use` (create the plan doc directly once Task 4's model exists — for now create a `scheduled` session dated tomorrow on machine 7); overlapping blocks → 400 `blocks_overlap`; nurse PUT → 403; front_desk PUT → 200 (new default perm); seeded front_desk has the five new perms.
- [ ] **Step 2: Run** `npm test -w server -- schedule/setup` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; then full `npm test -w server`.
- [ ] **Step 5: Commit** `feat(schedule): front-desk schedule setup`

---

### Task 2: Session model — new statuses and snapshots

**Files:** Modify `server/src/sessions/session.model.ts`, `server/src/schedule/generate.ts`, `server/src/sessions/service.ts` (open: set `runBy`), `server/src/sessions/card.ts` (expose new fields); Test `server/src/sessions/session.model.test.ts`.

**Interfaces:**
- Produces on `Session`:
  - `SESSION_STATUSES` adds `'did_not_come'`, `'cancelled'`.
  - `shiftStart: string`, `shiftEnd: string`, `chairLabel: string` (snapshots; required for new docs; backfilled by migration in Task 10).
  - `planId?: ObjectId`, `detached: boolean` (default false), `runBy?: ObjectId`, `rosterNurseId?: ObjectId`, `statusReason?: string`.
  - Partial unique index `{chairId:1, shiftId:1, date:1}` where `status ∈ {scheduled, active, completed}` — the hard double-booking guard. (Keep the existing `{patientId, date, shiftId}` unique.)
  - `FINAL_STATUSES = ['completed','postponed','missed','did_not_come','cancelled']`.
- `SessionCard` gains `start`, `end` from the snapshot (fall back to shift), `chairLabel`, `nurse: {id,name} | null` (filled in Task 6), `runBy: {id,name} | null`.

- [ ] **Step 1: Failing tests** — two `scheduled` sessions of different patients on same chair/shift/date → second insert throws E11000; same with first `postponed` → second succeeds; status `did_not_come` and `cancelled` accepted; opening a session sets `runBy` to the opener.
- [ ] **Step 2–4:** FAIL → implement → PASS (full server suite: update any test that creates sessions without snapshot fields via a shared factory `makeSession(overrides)` in `server/test/factories.ts`).
- [ ] **Step 5: Commit** `feat(sessions): new statuses, snapshots, chair-date guard`

---

### Task 3: Slot availability service

**Files:** Create `server/src/schedule/slots.ts`, `server/src/schedule/plan.model.ts` (model only); Test `server/src/schedule/slots.test.ts`.

**Interfaces:**
- `Plan` model: `{ centreId, patientId, items: [{weekday 0..6, shiftId, chairId}] (1..7, unique weekday+shift), from: string, to: string|null, repeat: 'weekly' }` with partial unique `{patientId}` where `to: null` (one open plan per patient). One-off bookings do NOT create plans.
- `isSlotFree(centreId, chairId, shiftId, date, opts?: {ignorePatientId?: string, session?: ClientSession}): Promise<boolean>` — the spec §10a rule, exactly:
  1. a session with status `scheduled|active|completed` on (chair, shift, date) belonging to another patient → taken;
  2. an open-or-covering plan item of another patient (same weekday(date), `from ≤ date`, `to` null or `≥ date`, centre working day) → taken unless that plan's session for (patient, date, shift) exists with status `postponed|cancelled` or `detached: true` and a different chair/date;
  3. else free. `ignorePatientId` lets a patient's own plan/session not block themselves.
- `freeMachines(centreId, shiftId, date, opts?): Promise<{id,label}[]>` — active machines where `isSlotFree`; empty on non-working days.
- `assertPlanItemsFree(centreId, items, from, to, patientId, session)` — for each item, refuse 409 `slot_taken` if any other patient's plan item with the same (chair, shift, weekday) has an overlapping date range, or any `scheduled|active` session of another patient exists on a matching date ≥ from (≤ to).

- [ ] **Step 1: Failing tests** (Review Focus 1 & 2):
  - free slot → true; other patient's scheduled session → false; own session with `ignorePatientId` → true;
  - other patient's weekly plan item (Mon, from today, no sessions generated beyond 14 days) checked for a Monday 5 weeks out → false;
  - holder's Monday session postponed → that Monday true, next Monday false;
  - plan ended (`to` = last Monday) → the following Monday true;
  - `freeMachines` on a non-working day → `[]`;
  - `assertPlanItemsFree` overlapping date ranges → 409; adjacent ranges (A to 2026-11-30, B from 2026-12-01) → ok.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(schedule): single slot-availability service`

---

### Task 4: Plans and bookings (per-day, one-off or weekly)

**Files:** Rewrite `server/src/schedule/booking.ts`; Modify `server/src/schedule/routes.ts` (plan routes), `server/src/transfers/service.ts` and discharge route (use `endPlans`), `server/src/sessions/service.ts` (`createMakeup` uses `isSlotFree`); Delete `schedule/pattern.model.ts`, `schedule/slot.model.ts`; Rewrite `server/src/schedule/booking.test.ts`.

**Interfaces:**
- `PlanItemInput = {weekday, shiftId, chairId}`; `BookInput = {items: PlanItemInput[], from: string, repeat: 'once'|'weekly', to?: string|null}`.
- `bookPlan(centreId, patientId, input, audit?)`:
  - `repeat:'once'` → for each item create one `scheduled` session (kind `regular`) on the first date ≥ `from` matching the weekday, checked with `isSlotFree` inside one transaction; returns `{sessions}`. Allowed even if the patient has an open plan.
  - `repeat:'weekly'` → patient must have no open plan (409 `already_booked`); `assertPlanItemsFree`; create Plan; then `regenerateSessions(patientId)`; returns `{plan}`.
  - Validations as today: chair/shift of centre & active (404/400), working day (400 `not_working_day`), `from ≥ today` (400 `from_in_past`), patient active (409 `patient_not_active`/`transfer_pending`), `to ≥ from`.
- `changePlan(centreId, patientId, {items, from, to?})` — ends/replaces the open plan as `changePattern` did (ends at `from-1`, or deletes if `from ≤ open.from`), deletes the patient's `scheduled`, non-detached sessions with `date ≥ from`, creates the new plan, regenerates. Detached sessions are never deleted.
- `endPlans(patientId, lastDate, session)` — sets `to`, deletes `scheduled` non-detached sessions after `lastDate`.
- Routes (audited): `POST /api/centres/:c/patients/:id/plan` (`schedule.book`) body `BookInput`; `PUT .../plan` (`schedule.book`) change; `GET .../plan` (`schedule.view`) → `{plan|null}`; `GET /api/centres/:c/schedule/free?date&shiftId` (`schedule.view`) → `freeMachines`.

- [ ] **Step 1: Failing tests** — weekly Mon S2 M3 + Wed S1 M6 → sessions generated on the right days/blocks/machines for 14 days; once → exactly one session per item; two concurrent weekly bookings of two patients for the same (M3, S2, Mon) → `[201, 409]`; change plan from next week keeps a previously moved (detached) future session and removes old-weekday sessions (Review Focus 4); discharge ends plan; transfer accept ends plan; make-up onto a freed-for-that-date slot → 201, onto the holder's other date → 409.
- [ ] **Step 2–4:** FAIL → implement → PASS; full server suite (update transfers/discharge/makeup tests for plan API).
- [ ] **Step 5: Commit** `feat(schedule): per-day plans, one-off and weekly bookings`

---

### Task 5: Generation from plans and refresh on change

**Files:** Modify `server/src/schedule/generate.ts`, `server/src/notify/jobs.ts`; Test `server/src/schedule/generate.test.ts` (rewrite).

**Interfaces:**
- `regenerateSessions(patientId, today?)` — for the open plan, for dates `[max(today, from), min(today+13, to)]` on working days, per item matching the weekday: upsert `scheduled` session (`$setOnInsert`: centreId, chairId, planId, kind regular, shiftStart/shiftEnd/chairLabel snapshots). Skip a (patient, date, shift) that already exists (any status, including detached).
- `refreshFutureSessions(centreId, today?)` — for `scheduled` sessions with `date ≥ today`: update snapshots from current shift/chair; delete those on non-working days or inactive blocks/machines (the setup rules already prevent this while in use, so it's a safety net); then `generateAll`.
- `markMissed` also stores `rosterNurseId` (via Task 6's `finaliseSnapshot`; until then a stub).

- [ ] **Step 1: Failing tests** — plan Mon+Wed from a Saturday → 4 sessions in 14 days with correct snapshots; plan with `to` in 5 days → none after `to`; working day removed (Wed) → no Wed sessions generated; block time edited → future scheduled sessions' `shiftStart` updated, completed past session unchanged.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(schedule): generate from plans, refresh future sessions`

---

### Task 6: Dated nurse roster

**Files:** Create `server/src/schedule/roster.model.ts`, `server/src/schedule/roster.ts`, `server/src/schedule/roster.routes.ts`; Modify `server/src/sessions/card.ts` (nurse from roster), `server/src/sessions/service.ts` (`finaliseSnapshot`); Delete `schedule/assignment.model.ts` and the `/assignments` routes; Test `server/src/schedule/roster.test.ts`.

**Interfaces:**
- `RosterEntry { centreId, nurseId, shiftId, from: string, to: string, chairIds: ObjectId[] (empty = all machines), createdAt }`.
- `resolveRoster(centreId, date): Promise<Map<string /*`${shiftId}:${chairId}`*/, string /*nurseId*/>>` — precedence per machine: smallest `(to − from)` span wins; then non-empty `chairIds` over empty; then latest `createdAt`.
- `nurseFor(centreId, date, shiftId, chairId): Promise<string | null>`.
- `finaliseSnapshot(session, tx?)` — sets `rosterNurseId = nurseFor(...)` when a session reaches a FINAL status; called from close, postpone, did-not-come, cancel and `markMissed`.
- Routes (`schedule.assignNurses` to write, `schedule.view` to read; audited `roster.create|delete`):
  - `GET /api/centres/:c/roster?from&to` → entries with nurse name and machine labels;
  - `POST /api/centres/:c/roster {nurseId, shiftIds: string[], from, to, chairIds: string[]}` → one entry per shiftId (nurse must hold the `nurse` role in the centre → else 400 `not_a_nurse`; `from ≤ to`; span ≤ 92 days);
  - `DELETE /api/centres/:c/roster/:id`.
  - `GET /api/centres/:c/roster/resolved?date` → `[{shiftId, chairId, nurse:{id,name}|null}]` for every active machine × block.

- [ ] **Step 1: Failing tests** — month entry Rana S1 all machines + single-day entry Ali S1 M1–M2 on the 5th → 5th: M1/M2 Ali, M3 Rana; 6th: all Rana; week entry vs month entry → week wins; two same-span entries → latest wins; non-nurse → 400; Review Focus 3: session missed on the 5th → `rosterNurseId` Ali; then delete Ali's entry → session still shows Ali.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(schedule): dated nurse roster`

---

### Task 7: Session actions — did not come, cancel, move one

**Files:** Modify `server/src/sessions/service.ts`, `server/src/sessions/routes.ts`; Test `server/src/sessions/actions.test.ts`.

**Interfaces (all under `/api/centres/:c/sessions/:sid`, audited, session via `loadSessionInCentre`):**
- `POST /did-not-come {reason?}` (`sessions.postpone`) — from `scheduled|missed` → `did_not_come`, `statusReason`, `finaliseSnapshot`.
- `POST /cancel {reason}` (`sessions.postpone`; reason required 1..200) — from `scheduled` → `cancelled`.
- `POST /move {date, shiftId, chairId}` (`schedule.book`) — from `scheduled`, `date ≥ today`, working day, `isSlotFree(..., {ignorePatientId})` → updates date/shift/chair + snapshots, sets `detached: true`. 409 `slot_taken` otherwise.
- Postpone unchanged.

- [ ] **Step 1: Failing tests** — did-not-come by front desk → status + reason + rosterNurseId; cancel without reason → 400; move to a free slot → detached and old slot free for that date; move onto taken slot → 409; nurse without `schedule.book` move → 403; regeneration after a move does not recreate the original date's session (unique `{patientId,date,shiftId}` + detached skip).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(sessions): did not come, cancel, move one`

---

### Task 8: Today board API

**Files:** Create `server/src/schedule/board.ts`; Modify `server/src/schedule/routes.ts` (replace `/today`); Test `server/src/schedule/board.test.ts`.

**Interfaces:**
- `GET /api/centres/:c/board?date&shiftId` (`sessions.view`) → `BoardDto = { date, working: boolean, blocks: {id,name,start,end}[], shiftId: string|null, active: Row[], waiting: Row[], done: Row[], didNotCome: Row[], other: Row[] /*postponed, cancelled, missed*/, emptyMachines: {id,label}[] }` with `Row = SessionCard & { nurse: {id,name}|null, mine: boolean }` (`mine` = rostered nurse or `runBy` is the caller).
- Default `shiftId`: block with `start ≤ now < end` (APP_TZ), else the next block today, else the last block. `date` default today.
- Non-working day → `working:false`, empty lists.

- [ ] **Step 1: Failing tests** (Review Focus 5) — at 11:59 default = Session 1, at 12:00 = Session 2, at 17:00 = Session 2 (last); Friday → `working:false`; rows grouped by status; `mine` true for the rostered nurse and for a nurse who ran another nurse's machine; empty machines listed.
- [ ] **Step 2–4:** FAIL → implement (inject `now` for tests) → PASS.
- [ ] **Step 5: Commit** `feat(schedule): today board API`

---

### Task 9: Patient timeline and doctor notes

**Files:** Create `server/src/sessions/timeline.ts`, `server/src/notes/patient-note.model.ts`, `server/src/notes/routes.ts`; Modify `server/src/sessions/routes.ts` (replace patient history route), `server/src/me/routes.ts` (`/me/timeline`, keep `/me/overview`); Tests `server/src/sessions/timeline.test.ts`, `server/src/notes/notes.test.ts`.

**Interfaces:**
- `PatientNote { patientId, centreId, authorId, text (1..2000), at }`. Routes: `GET/POST /api/centres/:c/patients/:id/notes` (`orders.view` / `orders.write`), patient via `loadPatientInCentre`.
- `buildTimeline(patientId, viewer: {kind:'staff', centreId} | {kind:'patient', seeNotes: boolean}, {before?, limit=20}) → { upcoming: Item[] (scheduled, today+1..today+13, ascending), today: Item[], past: Item[] (newest first, paged by `before`), notes: NoteItem[] (in the past page's date span, plus last 30 days on first page) }`.
  - `Item = { id, date, start, end, block, chairLabel, centreId, centreName, status, kind, detached, nurse: {name}|null /* runBy ?? rosterNurseId ?? resolved roster for future */, medicines: {name, amount, unit}[], statusReason?: string }`; staff items also carry `linkable: centreId === viewer.centreId`.
  - Patient viewer: never staff ids; notes/orders only if `seeNotes`.
- Staff route `GET /api/centres/:c/patients/:id/timeline?before&limit` (`sessions.view`); patient route `GET /api/me/timeline`.
- Session detail `orders` banner also returns `recentNotes` (patient notes from the last 30 days).

- [ ] **Step 1: Failing tests** — upcoming/today/past split; past paging by `before`; nurse = runBy if ran, else rosterNurseId, else roster for future; patient view hides notes when setting off and has no ids; transferred patient's old-centre sessions present with `linkable:false`; doctor creates note → appears in timeline and in next session's `recentNotes`; nurse POST note → 403.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: patient timeline and doctor notes`

---

### Task 10: Migration, seeds and permissions

**Files:** Create `server/src/seed/migrate-v2.ts` (+ CLI `migrate-v2-cli.ts`, script `npm run migrate:v2 -w server`); Modify `server/src/seed/demo.ts`, `server/src/seed/e2e.ts`, `deploy/README.md` ("Updating" section: run migrate:v2 once); Test `server/src/seed/migrate-v2.test.ts`.

**Interfaces:**
- `migrateV2(): Promise<{plans, roster, sessions, roles, skipped: string[]}>` — idempotent (marker doc `migrations: {_id:'v2'}`):
  - centres: `workingDays` = Sat–Thu ∪ weekdays used by old patterns;
  - each old `patterns` doc (raw collection) → `Plan` with one item per weekday (old chair & shift), same from/to; old `slots` collection dropped;
  - each old `chairassignments` group (nurse, shift) → roster entries per contiguous run of chair labels, `from` = today, `to` = today + 92 days;
  - sessions missing snapshots → backfill `shiftStart/shiftEnd/chairLabel`, `detached:false`;
  - `front_desk` role: `$addToSet` the five new perms.
  - Conflicts → skip and add to `skipped`, never throw half-way.
- Demo and e2e seeds create data in the v2 model directly.

- [ ] **Step 1: Failing tests** — fixture with raw old docs → migration produces expected plans/roster/backfills; second run → no changes; a conflicting pattern is skipped and reported.
- [ ] **Step 2–4:** FAIL → implement → PASS; `seed/demo.test.ts` still passes.
- [ ] **Step 5: Commit** `feat: v2 migration and seeds`

---

## Part B — Client

Conventions as before (features/<area>/api.ts hooks, `useCan`, `errorMessage`, i18n, MSW tests). Build must stay warning-free.

### Task 11: Schedule setup page and calendar

**Files:** Create `client/src/features/desk/SetupPage.tsx` (replaces `centre/SetupPage.tsx`; route `/c/:centreId/setup` now perm `schedule.setup`), `client/src/features/desk/proposeBlocks.ts`, `client/src/features/desk/CalendarPage.tsx` (replaces ScheduleGrid; route `/c/:centreId/schedule`); Tests `SetupPage.test.tsx`, `CalendarPage.test.tsx`.

**Interfaces:** Setup form = machine count, day start/end, session count → "Propose blocks" fills editable block rows (name/start/end), working-day chips, Save → `PUT /schedule/setup` (translate `in_use`, `blocks_overlap`). Calendar: week (desktop) / day (phone) of machines × blocks; each cell: empty (tap → BookDialog prefilled), booked (patient, status icon, tap → patient page), nurse per block-row from `GET /roster/resolved?date`, "No nurse" warning chip.

- [ ] **Step 1: Failing tests** — proposeBlocks parity with server cases; Save sends exact body; `in_use` shows translated error; calendar shows "No nurse" for an unrostered block and opens BookDialog with machine/block/date on an empty cell.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npm test -w client`, typecheck, build).
- [ ] **Step 5: Commit** `feat(client): schedule setup and calendar`

### Task 12: Roster page

**Files:** Create `client/src/features/desk/RosterPage.tsx` (replaces AssignNursesPage; route `/c/:centreId/schedule/roster`); Test `RosterPage.test.tsx`.

**Interfaces:** Form: nurse, blocks (multi), period chips "This session / Day / Week / Month" (Week = date..date+6, Month = date..date+29) or custom from/to, machines "All" or range/multi-select → `POST /roster`. List of entries for the visible week with delete. Gated by `schedule.assignNurses`.

- [ ] **Step 1: Failing tests** — "Week" from Mon 2 Nov posts `from 2026-11-02, to 2026-11-08`; machines "All" posts `chairIds: []`; delete calls DELETE.
- [ ] **Step 2–4 / Step 5:** … `feat(client): nurse roster`

### Task 13: Booking dialog and front-desk timeline actions

**Files:** Rewrite `client/src/features/desk/BookDialog.tsx`; Modify `client/src/features/desk/PatientPage.tsx`; Create `client/src/features/desk/MoveDialog.tsx`, `CancelDialog.tsx`; Tests `BookDialog.test.tsx`, `MoveDialog.test.tsx`.

**Interfaces:** BookDialog: patient, day rows (weekday, block, machine from `GET /schedule/free?date=<first matching date ≥ from>&shiftId`), "+ Add day", start date, Repeat (Just these sessions / Every week, until: none or date) → `POST /plan` (or `PUT /plan` in "Change weekly plan from a date" mode). Timeline row actions (front desk, by permission): Move this one (`POST /move`), Postpone → make-up (existing), Cancel (reason), Did not come (today/past only).

- [ ] **Step 1: Failing tests** — Monday S2 M3 + Wednesday S1 M6 weekly no-end posts `{items:[{weekday:1,…},{weekday:3,…}], from, repeat:'weekly', to:null}`; machine list only shows free machines from MSW; `slot_taken` refetches free list and shows message; Move posts body and closes.
- [ ] **Step 2–4 / Step 5:** … `feat(client): per-day booking and session actions`

### Task 14: Shared Today board

**Files:** Create `client/src/features/board/BoardPage.tsx`, `client/src/features/board/api.ts` (refetchInterval 30 000); Modify nav (`today` item perm `sessions.view`, path `/c/:centreId/today`), landing path for anyone with `sessions.view`; Delete `nurse/TodayPage.tsx`; Test `BoardPage.test.tsx`.

**Interfaces:** Block switch (SegmentedControl), groups Active now / Waiting / summary line; "My machines" toggle default on when the user holds the `nurse` role-perm set (`sessions.run` without `schedule.book`) — else off; row buttons by permission: Open, Start (`sessions.run`), Did not come & Postpone (`sessions.postpone`); "Centre closed today" when `working:false`.

- [ ] **Step 1: Failing tests** — groups render from MSW; nurse sees only mine until toggle; front desk sees all; Start posts open and row moves to Active after refetch; closed-day message.
- [ ] **Step 2–4 / Step 5:** … `feat(client): shared today board`

### Task 15: Shared patient timeline and doctor notes

**Files:** Create `client/src/components/Timeline.tsx` (replaces SessionHistory; used by desk PatientPage, `/me` history, SessionPage link); Modify `client/src/features/doctor/OrdersPanel.tsx` (+ patient notes form), `client/src/features/patient/MePage.tsx` (history via Timeline); Delete `components/SessionHistory.tsx`, `patient/HistoryPage.tsx`; Tests `Timeline.test.tsx`, update OrderForm/MePage tests.

**Interfaces:** Timeline props `{source: {kind:'staff', centreId, patientId} | {kind:'me'}, actions?: (item) => ReactNode}`; sections Upcoming / Today / Past (Load more), each row: weekday+date, block + times, machine, nurse, status badge (incl. Did not come, Cancelled, Moved, Make-up), medicines; notes interleaved by date; rows link to the session page only when `linkable`.

- [ ] **Step 1: Failing tests** — sections and badges render; patient source hides notes when absent; doctor adds a note and it appears; non-linkable row has no link.
- [ ] **Step 2–4 / Step 5:** … `feat(client): shared patient timeline and doctor notes`

### Task 16: E2E and handover

**Files:** Modify `e2e/core-flow.spec.ts`, `README.md`, `deploy/README.md`.

- [ ] **Step 1:** Rewrite the e2e: front desk builds schedule (4 machines, 08–16, 2 blocks, Sat–Thu incl. today's weekday — if today is Friday the e2e seed sets working days to all days) → roster nurse for today Session 1 all machines → books patient weekly on today's weekday Session 1 and one other day Session 2 → doctor adds a patient note and an order → nurse sees row on board under My machines, starts, records Heparin 5 cc, closes → front desk marks another patient's session Did not come → patient timeline shows Completed with Heparin 5 cc → PM dashboard 1 session.
- [ ] **Step 2: Run** root `npm test`, typechecks, client build, `npm run e2e` → all pass.
- [ ] **Step 3:** Docker check: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`, run `npm run migrate:v2 -w server` in the app container, smoke `curl -sk https://localhost/api/health`.
- [ ] **Step 4: Commit** `test: v2 core flow e2e; docs`

---

## Spec coverage map

| Spec § | Tasks |
| --- | --- |
| 2 Schedule setup | 1, 11 |
| 3 Nurse roster | 6, 12 |
| 4 Booking | 3, 4, 13 |
| 5 Changing bookings | 4, 7, 13 |
| 6 Statuses & front-desk session perms | 1, 2, 7 |
| 7 Today board | 8, 14 |
| 8 Patient timeline | 9, 15 |
| 9 Doctor notes | 9, 15 |
| 10 / 10a Migration & rules | 3, 5, 6, 10 |
| 11 Constraints / e2e | 16 |
