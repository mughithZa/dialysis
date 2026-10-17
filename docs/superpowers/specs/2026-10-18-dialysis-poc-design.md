# Dialysis Centre Software: POC Design

Date: 18 Oct 2026. Builds on `Dialysis Center Software - Requirements v1.md` (17 Oct 2026). Where this document and the requirements disagree, this document wins.

Items marked **(builder's call)** were decided by Claude during design, not by the client; they can be changed without going back to the client.

## 1. Intent

Charity dialysis centres run by UOCA (اتحاد الجمعيات الخيرية بدمشق, the Union of Charitable Associations in Damascus) do everything verbally or on paper. This software puts it in one shared database: patients, the weekly chair schedule, what happens in each session, and what medicines and supplies are used. The use data then feeds monthly reports.

This is a **proof of concept**: at most 5 centres and about 50 staff users (plus patients). It has to show that the full daily flow works end to end. It does not need to be hardened for production.

After launch, **one engineer** maintains it, supports users and builds phase 2. The code must be plain, conventional and easy for one person to pick up. Avoid clever abstractions.

### What success looks like

The core flow works smoothly, on a phone, with no workarounds:

1. The front desk adds a patient and books them onto a chair, days and shift.
2. Sessions appear for the nurse assigned to that chair.
3. The doctor optionally writes orders.
4. The nurse opens the session, records medicines, supplies, vitals and notes, and closes it.
5. The doctor and the patient see the result in the patient's history, and the program manager's monthly numbers reflect it.

The first real use is the program manager creating centres and handing them to centre managers. That path must also be smooth.

### Anti-goals (failure even if it "works")

- One centre sees another centre's patient data.
- A patient sees another patient's data.
- Medicine and supply totals are wrong because of duplicate or inconsistent list items or units.
- A nurse is blocked from running a session because something optional (doctor orders, vitals) is missing.
- The app is painful on a phone.

## 2. Constraints and decisions on how it's built

| Topic | Decision | By |
| --- | --- | --- |
| Stack | Node.js backend, React frontend | Client (engineer's skills) |
| Database | PostgreSQL | Builder's call |
| Hosting | One VPS run by the client | Client |
| Delivery | Web app, installable as a PWA (Android "Install app", iOS "Add to Home Screen"), with web push notifications | Client |
| Store apps | Not in POC. Later, wrap the same React app with Capacitor | Builder's call (direction) |
| Device | Phone first: every screen must work well at phone width and scale up to desktop. The nurse's screens matter most | Client (all users are online via their phones) |
| Offline | Not needed | Client |
| Language | English only in POC. All UI text goes through an i18n layer, and layouts use logical CSS properties (start/end, not left/right) so Arabic RTL can be added without rework | Client (English first) / builder's call (prepare for RTL) |
| Visual design | Neutral and functional. No UOCA branding yet. Keep colours and fonts in one theme file so branding is a small later change | Client |
| Security | Light for POC: HTTPS, hashed passwords, strict server-side access checks by centre and by own-record. No further hardening | Client |
| Backups | Not a focus for POC | Client |
| Exports | None. Dashboards are view only | Client |

The library choices within Node and React (framework, ORM, UI kit, auth library) are left to the builder. Prefer mainstream, well-documented options.

## 3. Roles and permissions

### 3.1 Dynamic roles

Roles are **editable bundles of permissions**, not hard-coded. The six roles below ship as seeded defaults. The **program manager** can edit any role's permissions and create new roles. Roles are global: the same definitions apply in every centre.

The centre manager **assigns** roles to users in their own centre but cannot change what a role allows, and can never assign the program manager role or any role carrying cross-centre permissions.

A user can hold **several roles in a centre** (for example Centre manager + Front desk). Their permissions are the union of those roles.

Example the client gave: in some centres the front desk records the medicines used in a session. That should be done by ticking "Record medicines and supplies" on the Front desk role, with no code change.

### 3.2 Permission catalogue (by category)

| Category | Permissions |
| --- | --- |
| Centres | Create centre · Close centre · View cross-centre statistics |
| Users & roles | Create users · Edit/deactivate users · Reset passwords · Assign roles · Edit roles |
| Patients | View patients · Create patient · Edit patient record · Discharge · Send transfer · Accept/reject transfer |
| Schedule | View schedule · Book/change a patient's slot · One-off reschedule (make-up session) · Manage chairs and shifts · Assign nurses to chairs |
| Sessions | View sessions · Open/close session · Record medicines and supplies · Record vitals · Add session notes · Edit closed session · View change history |
| Doctor orders | View orders · Write orders/alerts |
| Medicine & supply list | View list · Add missing item · Manage list (approve, edit, merge duplicates, manage units) |
| Reports & audit | Centre reports · Audit log |
| Centre settings | Patients can see notes · Reminder timing |

The builder may split or rename permissions where the code needs it, as long as the categories and the front-desk example still work.

### 3.3 Scope rules (fixed in code, not editable)

- A user's permissions apply only in the centres they are linked to. A doctor linked to two centres has their permissions in both.
- "View cross-centre statistics" is the only cross-centre permission. It returns **aggregates only**: no patient names, chairs or staff.
- **Patient** is a special role scoped to the patient's own record only. No role edit can widen it.
- Enforcement is on the server for every request, not only by hiding UI.

### 3.4 Seeded default roles

| Role | Default permissions (summary) |
| --- | --- |
| Program manager | Centres (all), Users & roles (create centre managers, edit roles), Medicine list (manage), cross-centre statistics |
| Centre manager | Everything inside their centre, read-only on clinical data, plus Users & roles (create users, assign roles, reset passwords), Audit log, Centre settings, Manage chairs and shifts |
| Front desk | Patients (all), Schedule (all), Create users (patients, nurses, doctors), Reset passwords, Medicine list (view, add missing) |
| Nurse | View patients on their assigned chairs, Sessions (all), View orders, Medicine list (view, add missing) |
| Doctor | View patients and sessions in their centres, Write orders, Medicine list (view, add missing) |
| Patient | Own schedule, own history and medicines, own notes if the centre allows it |

"Nurse sees their assigned chairs" is a default; whether a nurse can also see other chairs' sessions in the centre is left to the builder (a sensible default: nurses can look up any patient in the centre but their home screen shows their chairs).

## 4. Core entities

- **Centre**: name, active or closed. Has chairs and shifts.
- **Chair**: number or label, active or retired.
- **Shift**: name, start and end time. Defined per centre by the centre manager (for example morning 7:00–11:30, afternoon 12:00–16:30). Charity centres usually have 2.
- **User**: login (username and password), name, phone, linked to one or more centres, with roles per centre.
- **Patient**: also a User (for login) with a medical record: name, phone, emergency contact (a relative), cause of kidney failure, address, social situation, financial situation, other diseases, free-text notes. The record belongs to exactly one centre at a time.
- **Schedule pattern**: patient, chair, shift, weekdays (1–3 days), effective from and to dates.
- **Nurse assignment**: nurse, centre, **shift**, set of chairs (for example chairs 1–4 on the morning shift), effective from. Assignments are per shift because morning and afternoon nurses differ (builder's call). Sessions on a chair with no nurse assigned appear in an "Unassigned" list visible to all nurses in the centre and to the front desk, so they are never lost (builder's call).
- **Session**: patient, centre (where it took place), date, chair, shift, status, opened and closed times, opened by. Holds medicine and supply lines, optional vitals (weight before and after, blood pressure) and timed notes or events. Statuses (builder's call):
  - *scheduled*, then *active* (opened), then *completed* (closed).
  - *postponed*: set by the front desk or a nurse before or instead of the session. It is the trigger for booking a make-up session.
  - *missed*: set automatically at the end of the day for a scheduled session that was never opened. The front desk can still book a make-up for it.
  - "Sessions run" in reports counts *completed* only.
- **Doctor order**: patient, doctor, free text, start date, active or ended. Doctor orders are **free-text notes** for the nurse in the POC (client). There is no structured dosing and no "done" tracking. An order stays visible on the patient's upcoming sessions until the doctor ends it. Usage is tracked only through what is recorded in sessions. Orders are optional.
- **Change history**: every edit to a session after it is closed (notes, vitals, medicine or supply lines added, changed or removed) is recorded with who, when, and old and new values.
- **List item**: name, type (medicine or supply), unit, status (approved or pending review), created by.
- **Unit**: name (cc, ml, IU, mg, piece…). A managed list.
- **Transfer**: patient, from centre, to centre, status (pending, accepted, rejected), reason, actors and timestamps.
- **Audit entry**: who, what, which record, when.

## 5. Flows

### 5.1 Program manager: centres

1. Create a centre and its centre manager account (username and password handed over outside the app).
2. Close a centre: the centre becomes inactive and its users can no longer log in there. Data is kept. Rules (builder's call):
   - A centre can only be closed once it has no active patients: they must first be transferred or discharged.
   - Users linked to other centres (for example a doctor) keep those other links.
   - A closed centre can be reopened.
3. Reset a centre manager's password. The program manager sees centre manager accounts only, never other staff (builder's call).
4. Manage roles (3.1) and the medicine and supply list (5.8).
5. Dashboard (5.9).

### 5.2 Centre manager: setup

1. Define chairs and shifts.
2. Create users (front desk and others), assign roles.
3. Settings: patients can see notes (on or off); reminder lead time (for example 24 h or 15 h before the session).
4. Read-only view of everything in the centre, plus an audit view of what the front desk does.

### 5.3 Front desk: patients and staff

1. Create nurses and doctors. A doctor working in two centres is one user linked to both, linked by each centre's front desk. The builder decides how a front desk finds an existing doctor from another centre (for example by phone number) without exposing that centre's data.
2. Create a patient only after the medical and administrative approvals (outside the app). Walk-ins are not recorded.
3. Create the patient's login and hand over the credentials in person. Forgotten passwords are reset by the front desk.
4. Edit the patient record. The file grows over years.

### 5.4 Front desk: schedule

1. Grid view of chairs × shifts × weekdays, showing free and booked slots.
2. Book a patient onto a free slot pattern (chair, shift, 1–3 weekdays) from a start date.
3. Assign nurses to chairs.
4. **Shift change on request:** change the pattern from a chosen date. Past sessions are untouched.
5. **Make-up session:** a postponed session gets a one-off session within 1–3 days on any free chair and shift. The weekly pattern doesn't change.
6. **Discharge** with a reason (transplant, death, moved, travelled, left the program) and a date. The pattern ends, future scheduled sessions are removed, the slot is freed, and history is kept.

Session generation from patterns (how far ahead, on the fly or stored) is left to the builder. Requirements: the nurse sees today's sessions, the patient sees upcoming ones, and reminders fire on time.

### 5.5 Doctor: orders (optional)

1. Centre filter at the top when linked to several centres.
2. Per patient: session history with nurse notes, medicines and vitals.
3. Write orders or alerts for upcoming sessions as free text. Examples: give EPO, repeat a lab test, change from 2 to 3 sessions a week, adjust pump speed, "heparin-free". End an order when it no longer applies.
4. **Orders are optional.** Many sessions have none, and a doctor may not look at a patient for a while. Nothing in the nurse flow depends on orders.

### 5.6 Nurse: session (the most important screen)

1. Home: today's sessions on their assigned chairs, by shift.
2. Open a patient's session: shows active doctor orders and alerts if there are any.
3. **Open session** when the patient is at the machine. The patient's app shows it as active.
4. Record medicines and supplies: pick from the list, enter an amount in the item's unit. Heparin is **not enforced**: some patients are heparin-free, and the doctor states that in a free-text order (client). On close, if no heparin was recorded, show a non-blocking "No heparin recorded, close anyway?" confirmation (builder's call). Add a missing item on the spot (it goes in as pending review but is usable immediately).
5. Optional: weight before and after, blood pressure (more than one reading allowed).
6. Timed notes and events (for example BP drop and recovery, chills, cardiac arrest).
7. **Close session.** Everything becomes part of the patient's file.
8. **Fix mistakes after closing** (client): a user with "Edit closed session" can correct notes, vitals and medicine or supply lines. Every change is kept in the session's change history, which shows who changed what and when, including old and new values. Reports always use the current values.
   - By default the Nurse and Centre manager roles hold "Edit closed session" (builder's call).
   - Nurse, Doctor and Centre manager can view the change history (builder's call).
   - There is no time limit in the POC (builder's call).

Must be fast and comfortable on a phone, with big touch targets and minimal typing.

### 5.7 Transfer between centres

1. The old centre's front desk sends the patient to a chosen centre, with an optional note.
2. The new centre's front desk sees incoming transfers and **accepts or rejects** them, with a reason when rejecting.
3. **Accepted:** the whole file (record, sessions, notes, orders) moves. The old centre loses all access. The old schedule pattern ends, and the new centre books a slot.
4. **Rejected or pending:** the patient stays fully with the old centre (builder's call).
5. The program manager is not involved.

### 5.8 Medicine and supply list (must be done properly: reports depend on it)

1. One list for all centres, owned by the program manager.
2. Each item has a type (medicine or supply) and a **unit** chosen from the units list when the item is added. A new unit can be added at that moment.
3. Front desk, nurses and doctors can add a missing item. It is usable immediately but flagged **pending review**.
4. The program manager reviews pending items: approve, edit, or **merge into an existing item**. A merge re-points all past usage to the surviving item, so totals stay correct.
   - Merges are only allowed between items with the same unit.
   - An item's unit is locked once it has been used.
   - A wrongly-united pending item is fixed by editing its unit before it is first used. Otherwise it is retired and re-created. (Builder's call, to protect totals.)
5. All doses are entered as an amount in the item's unit, never free text.

### 5.9 Program manager dashboard (view only)

Filter by month (and optionally by centre). Per centre:

- number of sessions run
- number of patients
- medicine use (total per item, in its unit)
- supply use (total per item)

Aggregates only, never individual patients. No export in POC.

Reports count each session at the centre where it took place, even after the patient is transferred. A centre's past months never change because of a transfer, and the old centre's aggregate counts keep that activity. Access to the patient's file still follows the patient's current centre (builder's call).

### 5.10 Patient

1. Upcoming sessions (day, time, centre) and history.
2. Medicines and doses per session.
3. "Session active now" indicator.
4. Nurse and doctor notes only if the centre setting allows it.
5. Reminder push notification at the centre's set lead time. Upcoming sessions are always visible in the app as a fallback (builder's call).
6. View only.

Notifications: web push via the PWA. On iPhone this needs the app added to the home screen (iOS 16.4+). An in-app prompt should guide patients to install it and allow notifications (builder's call).

## 6. Not in the POC

- Store apps (later via Capacitor), SMS (credential delivery and resets later), Arabic UI (later; structure ready now).
- Lab results, session cost calculation, stock or inventory, machine and water maintenance, staff attendance, donor or ministry reports, exports.
- Patients split across centres, emergency sessions at another centre.
- Production hardening and backup routine.
- UOCA branding.
- Other specialties (keep naming generic where it's free to do so, but don't build for them).

## 7. Left to the builder

- Libraries, project structure, API style, auth mechanism (sessions or tokens).
- How sessions are generated from patterns.
- Exact screen layouts, within "phone first, functional, neutral".
- How a front desk finds and links an existing multi-centre doctor.
- Seed data for a demo (centres, chairs, list items, units) is recommended.
- Deployment setup on the VPS.
