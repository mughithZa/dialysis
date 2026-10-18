# Scheduling v2: Calendar, Nurse Roster, Today Board, Patient Timeline

Date: 18 Oct 2026. Builds on the POC already built (`docs/superpowers/specs/2026-10-18-dialysis-poc-design.md` and the code on `main`). Where this document and the POC design disagree, this document wins for scheduling, sessions and timelines. Everything else (roles, permissions, transfers, medicine list, reports, PWA) stays as built.

Items marked **(builder's call)** were decided by Claude during design, not by the client, and can change without going back to the client.

## 1. Intent

The client's words: "my core system are the sessions". The front desk runs the centre like a calendar:

1. **Before any patient**, she builds the empty schedule: how many machines (chairs) there are, the working day (for example 8am–4pm), and how many sessions fit in a day, split into blocks (for example 8–12 and 12–4).
2. She puts **nurses on duty** by session block and machines, for one session, a day, a week or a month, like a hospital roster.
3. She **books patients** into empty slots. A patient can come on different days in different sessions, for example Monday 12–4 on machine 3 and Wednesday 8–12 on machine 6. A booking is either a one-off or repeats every week, on the same day and time, for weeks or months.
4. Everyone works from a **Today board** showing active sessions now, so they can act on them directly.
5. Everyone reads **one patient timeline**: the patient's sessions, past and upcoming. The patient sees it, and so do the front desk, nurses and doctors.

### What's different from the current build

| Today (built) | v2 |
| --- | --- |
| Centre manager defines chairs and shifts | **Front desk** builds the schedule: machine count, working day, session blocks, working days |
| One pattern per patient: one chair and one shift for all days | **Per-day** booking: each weekday has its own session block and machine |
| A pattern always repeats weekly | **One-off or weekly**, and weekly runs with no end or until an end date |
| Nurse assignment = chairs per shift, no dates | **Dated nurse roster**: a nurse on a session block and machine range for one date or a date range |
| Statuses scheduled / active / completed / postponed / missed | Add **Did not come** and **Cancelled**. No "Arrived" step |
| Nurse "Today" page only | One **Today board** for front desk, nurses and doctors; whole centre visible |
| Patient history pages differ by role | **One patient timeline** component, past and upcoming, used by everyone |
| Doctor writes orders | Doctor can also write **patient-level notes**, not tied to a session |

### Anti-goals (failure even if it "works")
- Two patients on the same machine in the same session on the same date.
- A booked session with no visible nurse, without anyone noticing it on the board.
- Rescheduling one session silently changes the patient's whole weekly plan, or the other way round.
- History rewritten. Past sessions must keep the machine, session block and nurse that actually applied on that day.
- Losing the existing POC behaviour for transfers, centre isolation, closed-session edits, medicine usage and reports.

## 2. Schedule setup (front desk)

- **Permission:** `schedule.setup`, which already exists. The default **front_desk** role gains `schedule.setup`. Centre manager keeps it.
- **Machines:** the front desk sets a **number of machines**. They are numbered 1..N and the labels can be edited. Raising N adds machines. Lowering N retires the highest-numbered machines, and is refused (409) if a retired machine has future booked sessions (builder's call). The existing `Chair` model is the machine.
- **Working day and session blocks:**
  - She enters day start, day end and the number of sessions. The system proposes equal blocks, for example 08:00–16:00 with 2 sessions gives 08:00–12:00 and 12:00–16:00, and she can edit each block's times and name.
  - Blocks must not overlap. The existing `Shift` model is the session block.
- **Working days:** the weekdays the centre runs, for example Sat–Thu with Friday off. These are stored on the centre. Slots exist only on working days.
- **Changing the setup later:** an edit applies to dates from the edit onwards. Past sessions keep the block, machine and times that applied when they happened. Store the shift start and end and the machine label on each session, so history never changes (builder's call).
- **The calendar:** a week view (and day view on phones) showing every machine × session block × working day, each slot **empty**, **booked** (patient name) or **past** (with its outcome). The nurse on duty shows on each block. This replaces the current schedule grid.

## 3. Nurse roster

- **Permission:** `schedule.assignNurses`, which already exists. The front desk holds it.
- **What a roster entry is:** a nurse on a **date or date range** (one day, a week or a month), a **session block**, and a **machine range** or "all machines". Example: Rana, 1–31 Nov, Session 1, machines 1–4.
- **Overrides:** a more specific entry beats a wider one. A single-date entry beats a range, so covering one sick day is a single quick entry. Between entries of the same specificity, the latest one wins (builder's call).
- **Who covers a slot:** the nurse for a session on a date is looked up from the roster. A slot with no roster nurse shows **"No nurse"** on the calendar and on the Today board.
- **Who actually ran it:** when a session is started, the user who starts it is stored as `runBy`. History shows `runBy`, or the rostered nurse if it was never started.
- The current `ChairAssignment` (no dates) is replaced by the roster. Migrate existing assignments into open-ended roster entries starting today (builder's call).

## 4. Booking patients

- **Permission:** `schedule.book`, which already exists.
- **The booking dialog** (from an empty slot or from the patient):
  - Pick the patient.
  - Add one or more **day rows**. Each row has a weekday, a session block and a machine, and only machines free for that day and block are offered.
  - Pick a **start date**.
  - Choose **Repeat**: either "Just these sessions", which books each row's next occurrence once, or "Every week, same days and times", with **no end date** or **until** a chosen date.
- **Data:**
  - A booking becomes one plan per patient, holding a list of `{weekday, shiftId, chairId}` items, a `from` date, an optional `to` date and `repeat: weekly|once`. This generalises the current `Pattern`, which has one chair and one shift for all days.
  - Keep the "one open plan per patient" rule.
  - Slot holding moves to a per-item key `{chairId, shiftId, weekday}`, so the current `Slot` unique index still prevents double booking for weekly plans.
  - One-off bookings are plain sessions with a unique `{chairId, shiftId, date}`.
  - Double booking must be impossible for any date, whether it comes from a weekly plan or a one-off. Two simultaneous bookings: one succeeds, one gets 409.
- **Session generation:** the existing nightly generation (14 days ahead) generates from all plan items. One-off sessions are created directly.

## 5. Changing bookings (front desk, from the patient timeline or the calendar)

On an upcoming session:
- **Move this one:** pick a new date, block and machine from the free ones. This changes only that session, and the weekly plan is untouched.
- **Postpone → make-up:** same as now. The session becomes Postponed and a make-up is booked within 1–3 days.
- **Cancel:** the session becomes Cancelled, with a reason (for example a hospital admission).

On the plan:
- **Change the weekly plan from a date:** edit the day rows from a chosen date. Future scheduled sessions follow the new plan. Past sessions and sessions already moved one-off stay as they are (builder's call: a moved session is "detached" and regeneration never overwrites it).
- **End the plan:** this is what discharge already does.

## 6. Session statuses

`scheduled → active → completed`, plus:
- **did_not_come:** set by the front desk or a nurse on a scheduled session, with an optional reason. It counts as a miss in history. A make-up can still be booked for it.
- **postponed:** as now, set by the front desk or a nurse, and leads to a make-up.
- **cancelled:** set by the front desk, with a reason. It is not counted as a miss.
- **missed:** set automatically at the end of the day if a session is still scheduled. This already exists.

There is **no "Arrived" step**. Starting the session (scheduled → active) is the attendance signal. Reports continue to count completed sessions only. Any role with the right permissions can start or close a session, record medicines or vitals and add notes: the client said the front desk must be able to cover busy nurses. The default **front_desk** role gains `sessions.run`, `sessions.recordUsage`, `sessions.recordVitals` and `sessions.addNotes`. Roles remain editable by the program manager.

New permission: none needed. Did not come and Cancel use `sessions.postpone` (rename the label in the catalogue to "Postpone, cancel, did not come"; builder's call).

## 7. The Today board (front desk, nurse, doctor)

- **One shared page** for anyone with `sessions.view` (replaces the nurse Today page).
- **Layout:**
  - It shows today's date with a switch between session blocks, defaulting to the block happening now.
  - The block is split into three groups:
    - **Active now:** machine, patient, nurse, start time, a flag for active orders, and an Open button.
    - **Waiting:** machine, patient, rostered nurse, and buttons for Start, Did not come and Postpone, each shown by permission.
    - **Summary:** done, did not come, postponed or cancelled, and empty machines.
- **Whole centre for everyone.** A nurse sees **her machines first**, with "All machines" one tap away, so she can cover another nurse. The front desk and doctors see all machines by default.
- Each session opens the existing session page (medicines, vitals, notes, orders banner, close, edit after close, change history).
- **Live refresh:** the board polls every 30 s while open (builder's call: no websockets in the POC).

## 8. The patient timeline (everyone)

- **One component** used in the patient's app (`/me`) and on the staff patient page.
- It shows **Upcoming** (next 14 days of generated sessions plus one-offs), then **Today**, then **Past**, newest first, with "Load more".
- **Each row** shows the date, session block and times, machine, nurse (`runBy` if it ran, else the rostered nurse), status, a short list of medicines given, and a make-up or moved marker. Tapping a row opens the session.
- **Doctor patient notes** (§9) appear in the timeline at their date.
- **What differs by role:**
  - **Patient:** read-only. Notes (nurse and doctor) show only if the centre allows it (existing setting).
  - **Staff:** see everything their permissions allow. The front desk also gets the row actions from §5.
  - **Doctors:** add notes and orders from the same page.
- Sessions held at a previous centre (after a transfer) appear, without a link, as today.

## 9. Doctor patient notes

- A **patient-level note**: free text, author, timestamp, centre. It is not tied to any session.
- **Permission:** `orders.write`, which the doctor already holds.
- Notes show on the patient timeline and in the orders banner on the next session (recent notes from the last 30 days, builder's call).
- They are visible to the patient only if the centre's "patients see notes" setting is on.
- Existing patient-level orders stay as they are.

## 10. Migration of existing data (builder's call)

- **Chairs and shifts** stay as they are and become machines and session blocks. Working days default to every day except Friday.
- Each **existing patient pattern** becomes a plan with one item per weekday, all using its old chair and shift, `repeat: weekly`.
- **Chair assignments** become open-ended roster entries from the migration date.
- A one-off **migration script** is idempotent and covered by a test. The demo and e2e seeds are updated to the new model.

## 10a. Rules settled after builder review (all builder's calls)

1. **What a slot is, and when it's free.** A slot is machine × session block × date.
   - **A slot is taken on a date** if:
     - a session exists for it with status scheduled, active or completed, or
     - a weekly plan item covers it: same weekday, `from ≤ date`, and `to` empty or `≥ date`.
   - **Exception:** the plan's own session for that date was moved, postponed or cancelled, so the slot is free for that date only.
   - **When a plan ends** (its `to` date, a discharge, or a "change from a date" edit), the slot is free from the next day. Another patient's plan may then start on the same weekday slot from a later date.
   - **Enforcement:**
     - A partial unique index on sessions `{chairId, shiftId, date}` for statuses scheduled, active and completed is the hard guarantee.
     - Plan bookings check for overlap with other plan items by date range, inside a transaction. This replaces the per-weekday `Slot` unique index.
   - **One rule everywhere:** the booking dialog's free-machine list, Move, make-up and plan booking all use a single `isSlotFree(chair, shift, date)` / `freeMachines(shift, date)` service.
2. **Roster precedence.**
   - Date specificity wins first (a single date beats a range, and a shorter range beats a longer one). Machine specificity comes next (a specific range beats all machines). Within the same specificity, the most recent entry wins.
   - Precedence is resolved **per machine**, so one machine has exactly one nurse per block per date.
   - One roster entry covers one session block. The UI can create entries for several blocks in one action.
3. **History stays frozen.**
   - When a session reaches a final status (completed, did not come, postponed, cancelled or missed), the rostered nurse is stored on it as `rosterNurseId`, next to `runBy`.
   - Session block times and the machine label are stored on each session when it is generated.
   - Future scheduled sessions are refreshed when setup or the roster changes. Past and final sessions never are.
4. **Setup edits with bookings in place.**
   - Changing a block's times applies immediately to future scheduled sessions (refreshed).
   - Deleting a block, or making a weekday non-working, is refused (409 `in_use`) while any open plan or future session uses it.
   - Lowering the machine count is refused while any open plan item or future session uses a retired machine.
5. **Migration.**
   - Working days = Sat–Thu plus any weekday existing plans already use.
   - Chair assignments become one roster entry per contiguous run of chairs.
   - The migration adds the new default permissions to the existing `front_desk` role. This is additive, so existing edits are kept.
   - If old data conflicts, the migration skips that record and logs it. It never fails half-way.
6. **Timezone:** as today, all dates and "now" use `APP_TZ` (Asia/Damascus).
7. **Counting:** Did not come counts as a miss and allows a make-up. Cancelled is not a miss.

## 11. Constraints (unchanged from the POC)

- Same stack and conventions: Express + Mongoose, React + Mantine, phone-first, every string through i18n, dynamic permissions checked on the server, centre isolation (404 across centres), and transactions for multi-document writes.
- All existing tests keep passing or are updated to the new model. The Playwright core-flow e2e is updated to the new flow: build schedule → roster → book per-day → Today board → run session → timeline.

## 12. Not in this round

- Centre-wide session log with filters, and a look-back calendar for reporting (the client said "we can see later").
- Nurse availability and leave management. The roster is entered manually.
- Notifications to staff about uncovered slots.
- Recurrence patterns other than weekly (for example every two weeks).

## 13. Left to the builder

Exact screen layouts within the mockups shown to the client (schedule builder, booking dialog with per-day rows, front desk timeline, Today board); API shapes; how roster precedence is computed; the calendar's phone layout; polling interval.
