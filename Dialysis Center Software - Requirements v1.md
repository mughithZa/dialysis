# Dialysis Center Software: Requirements v1

As of 17 Oct 2026. Sources: four voice notes from Na3im Alzabibi (Syrian Arabic, transcripts in `requirements/transcripts/`) and the follow-up answers given on 17 Oct 2026.

## 1. Summary

The software turns everything a dialysis centre now does verbally or on paper into electronic records. It serves six roles: program manager, centre manager, secretary (front desk), nurse, doctor and patient. All roles share one database and one visual identity, and each role has its own interface.

- **Platform:** the first version is web only, for all six roles. Mobile apps for nurse, doctor and patient come later.
- **Language:** the interface can switch languages. English comes first; Arabic (right to left) comes later.
- **Target users:** charity dialysis centres in Syria. The owning body may change later (possibly the Ministry of Health), so permissions are set in settings, not code.
- **Scope of v1:** the standard case only. Patients who split sessions across centres, emergency sessions at another centre, lab results and session cost calculation are not in v1.

## 2. How a dialysis centre works

- A patient keeps the same days, time, centre and usually the same chair. Example: Saturday, Monday, Wednesday on the same shift.
- Patients come 1, 2 or 3 times a week. A session lasts about 4 hours, up to 4.5 hours with preparation.
- Charity centres run 2 shifts a day (about 8 hours). Private centres can run about 14 hours.
- Chairs are never left empty. A new patient is admitted only when a slot frees up, which happens when a patient leaves (transplant, death, moved, travelled, left the program).
- Missing two sessions can be fatal, so a postponed session is made up within one to three days. The schedule changes only on the patient's request, for example a shift change.
- Medicines given during sessions: heparin (every session, for example 1 or 5 cc), EPO, iron, vitamins and others.

## 3. Roles and permissions

| Role | Sees | Does |
| --- | --- | --- |
| Program manager | All centres, statistics only, no patient details | Opens and closes centres, creates centre managers, keeps the medicine and supply list |
| Centre manager | Everything in their own centre, nothing in other centres | Creates secretaries, manages permissions, supervises, sets centre options |
| Secretary (front desk) | Their centre's patients, staff and schedule | Creates patients, nurses and doctors; books chairs and shifts; discharges; transfers |
| Nurse | Assigned chairs, patients' doctor orders | Opens and closes sessions, records medicines, supplies, vitals and notes |
| Doctor | Session history of patients in each centre they work in | Writes orders and alerts for upcoming sessions |
| Patient | Their own schedule, history and medicines (notes if enabled) | Views only, gets reminders |

## 4. Requirements by role

### 4.1 Program manager

1. Create a centre and its centre manager account, then hand the centre over.
2. Close (deactivate) a centre.
3. See a dashboard across centres with counts of centres, patients and sessions, plus medicine and supply use per centre.
4. Never see individual patients, chairs or staff.
5. Keep the shared list of medicines and supplies for all centres, and review items that staff add (see 5.2).
6. What this role can see is switchable in settings, so it can be narrowed (open and close centres only) or widened later.

### 4.2 Centre manager

1. Full read access to their own centre: patients, staff, schedule, sessions, statistics.
2. No access to any other centre.
3. Create secretary accounts and manage permissions for users in the centre.
4. See an audit view of what the secretary does.
5. Turn on or off whether patients can see nurse and doctor notes.
6. Set when patients get session reminders (for example 24 or 15 hours before).
7. Can also be given the secretary role, so one person runs the centre as both centre manager and front desk. That person gets both sets of permissions in one login.

### 4.3 Secretary (front desk)

1. Create patients, nurses and doctors. A doctor who works in two centres is linked to both, by each centre's secretary.
2. Register a new patient only after the doctor's medical approval and the centre's administrative approval (both happen outside the app). Walk-in inquiries are not recorded.
3. Patient record: name, phone, emergency contact (a relative), cause of kidney failure, address, social situation, financial situation, other diseases, and free-text notes. The file grows over the years.
4. Book each patient onto a chair, days and shift.
5. Assign each nurse to chairs (for example nurse X covers chairs 1 to 4).
6. See free and booked slots by chair and shift, and fill a freed slot with a new patient.
7. Change a patient's shift on request.
8. Discharge a patient with a reason: transplant, death, moved, travelled, left the program. This frees the slot.
9. Transfer a patient: the old centre's secretary sends the file and the new centre's secretary accepts it. The whole file (notes and sessions) moves, and the old centre loses access.
10. Add a missing medicine or supply to the shared list.

### 4.4 Nurse

1. Before a session, see the doctor's current orders and alerts for the patient.
2. Open a session when the patient sits at the machine. The patient then sees an active session.
3. Record medicines and supplies used by picking them from the shared list, with dose (for example heparin 1 or 5 cc). Heparin is required every session.
4. If an item is missing from the list, add it on the spot.
5. Optional fields: weight before and after, blood pressure.
6. Record events and notes during the session, for example a blood pressure drop and recovery, chills, cardiac arrest.
7. Close the session. Notes become part of the patient's file and are visible to the doctor.

### 4.5 Doctor

1. Work in one or more centres, with a centre filter at the top.
2. See nurse notes and medicines from previous sessions for each patient.
3. Write orders or alerts for upcoming sessions, for example give EPO, repeat a lab test, change from 2 to 3 sessions a week, raise or lower the pump speed. Nurses see these when they open the next session.
4. Pick medicines from the shared list, and add a missing one.

### 4.6 Patient

1. See upcoming sessions (day, time, centre) and session history.
2. See the medicines and doses given in each session.
3. See when a session is active.
4. See nurse and doctor notes only if the centre manager has turned this on.
5. Get a reminder before each session, at the time the centre manager set.

## 5. Shared rules

### 5.1 Data and access

- All interfaces write to one database.
- Users of one centre never see another centre's data. The only exception is a doctor linked to several centres.
- Every permission can be turned on or off from settings.
- One user can hold more than one role in a centre, for example centre manager and secretary.

### 5.2 Medicine and supply list

- One list for all centres, kept by the program manager.
- Nurses and doctors pick from the list, so use can be reported per patient, centre and month.
- Front desk, nurses and doctors can add a missing item. New items are flagged so the program manager can review them and merge duplicates (this review step is a suggestion, to be confirmed).

### 5.3 Schedule

- Sessions come from a fixed weekly pattern per patient (days, shift, chair), with one-off changes on request.

## 6. Not in v1

- Mobile apps (nurse, doctor and patient move to mobile later).
- Arabic interface (comes after English).
- Lab results.
- Session cost calculation. For reference, the cost of a session comes from consumables (dialyser, bloodlines, needles, acid concentrate, bicarbonate), medicines, water (160 to 180 L treated, from about 500 L raw, plus treatment station membranes), electricity (about 2,200 W per machine), staff, cleaning and maintenance.
- Patients who split sessions across centres, and emergency sessions at another centre.
- Other specialties. The structure should allow them later.

## 7. Decisions log (17 Oct 2026)

| Question | Decision |
| --- | --- |
| Web or mobile per role | All roles on web for v1 |
| Language | Switchable, English first, Arabic later |
| Who creates doctors | Secretary at each centre; a multi-centre doctor is linked to both |
| Session cost calculation | Not in the app |
| Program manager default view | Counts of centres, patients and sessions, plus medicine and supply use per centre |
| Medicine and supply list | One list kept by the program manager; front desk, nurses and doctors can add missing items |
| Patient sees notes | Centre manager setting |
| Transfers | Old centre's secretary sends, new centre's secretary accepts |
| Old centre after a transfer | No access |
| Vital signs | Optional: weight before and after, blood pressure |
| Lab results | Not in v1 |
| Centre manager and secretary | Can be the same person: a user can hold both roles |

## 8. Still worth deciding before build

- Login for patients (phone number with SMS code?) and what to do for patients without a smartphone or computer.
- Whether nurses need to work offline if the internet drops.
- Stock of medicines and supplies, machine and water station maintenance logs, staff attendance, and reports for donors or the ministry. None of these were mentioned.
- Privacy rules and backups for medical records.
