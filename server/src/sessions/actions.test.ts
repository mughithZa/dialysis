import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { AuditEntry } from '../audit/audit.model.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { regenerateSessions } from '../schedule/generate.js';
import { isSlotFree } from '../schedule/slots.js';
import { Session } from './session.model.js';
import { ALL_DAYS, makeCentre, makePatient, makeSession, staffIn } from '../../test/factories.js';

beforeEach(seedRoles);

async function setup() {
  const { centre, chairs, shifts } = await makeCentre({ workingDays: ALL_DAYS });
  const base = `/api/centres/${centre.id}`;
  const desk = await staffIn(centre.id, ['front_desk']);
  const nurse = await staffIn(centre.id, ['nurse']);
  const { patient } = await makePatient(centre.id);
  const today = todayLocal();
  const mk = (o: Partial<{ date: string; status: string; chair: number; shift: number; patientId: string }> = {}) =>
    makeSession({
      centreId: centre.id,
      patientId: o.patientId ?? patient.id,
      chairId: chairs[o.chair ?? 0]!.id,
      shiftId: shifts[o.shift ?? 0]!.id,
      date: o.date ?? today,
      status: o.status ?? 'scheduled',
    });
  return { centre, chairs, shifts, base, desk, nurse, patient, today, mk };
}

describe('did not come', () => {
  it('front desk marks a scheduled session, with reason and roster nurse, audited', async () => {
    const { base, desk, nurse, shifts, today, mk } = await setup();
    const rostered = await desk.agent
      .post(`${base}/roster`)
      .send({ nurseId: nurse.user.id, shiftIds: [shifts[0]!.id], from: today, to: today, chairIds: [] });
    expect(rostered.status).toBe(201);
    const s = await mk();
    const res = await desk.agent.post(`${base}/sessions/${s.id}/did-not-come`).send({ reason: 'sick' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('did_not_come');
    const doc = (await Session.findById(s.id))!;
    expect([doc.statusReason, String(doc.rosterNurseId)]).toEqual(['sick', nurse.user.id]);
    expect(await AuditEntry.countDocuments({ action: 'session.did_not_come' })).toBe(1);
  });

  it('works from missed, reason optional; refuses other statuses and future dates', async () => {
    const { base, desk, today, mk } = await setup();
    const missed = await mk({ date: addDays(today, -1), status: 'missed' });
    expect((await desk.agent.post(`${base}/sessions/${missed.id}/did-not-come`).send({})).status).toBe(200);
    const done = await mk({ date: addDays(today, -2), status: 'completed' });
    expect((await desk.agent.post(`${base}/sessions/${done.id}/did-not-come`).send({})).body.error).toBe('bad_status');
    const future = await mk({ date: addDays(today, 2) });
    const r = await desk.agent.post(`${base}/sessions/${future.id}/did-not-come`).send({});
    expect([r.status, r.body.error]).toEqual([409, 'not_yet']);
  });
});

describe('cancel', () => {
  it('needs a reason (1..200)', async () => {
    const { base, desk, today, mk } = await setup();
    const s = await mk({ date: addDays(today, 1) });
    const url = `${base}/sessions/${s.id}/cancel`;
    expect((await desk.agent.post(url).send({})).status).toBe(400);
    expect((await desk.agent.post(url).send({ reason: '' })).status).toBe(400);
    expect((await desk.agent.post(url).send({ reason: 'x'.repeat(201) })).status).toBe(400);
    const ok = await desk.agent.post(url).send({ reason: 'holiday' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('cancelled');
    expect((await Session.findById(s.id))!.statusReason).toBe('holiday');
    expect((await desk.agent.post(url).send({ reason: 'again' })).body.error).toBe('bad_status');
    expect(await AuditEntry.countDocuments({ action: 'session.cancel' })).toBe(1);
  });
});

describe('move one', () => {
  it('moves to a free slot: detached, snapshots updated, old slot free, audited; re-move keeps first original', async () => {
    const { centre, base, desk, chairs, shifts, today, mk } = await setup();
    const date = addDays(today, 1);
    const s = await mk({ date });
    const to = addDays(today, 2);
    const res = await desk.agent.post(`${base}/sessions/${s.id}/move`).send({ date: to, shiftId: shifts[1]!.id, chairId: chairs[2]!.id });
    expect(res.status).toBe(200);
    const doc = (await Session.findById(s.id))!;
    expect([doc.date, String(doc.shiftId), String(doc.chairId), doc.detached]).toEqual([to, shifts[1]!.id, chairs[2]!.id, true]);
    expect([doc.shiftStart, doc.shiftEnd, doc.chairLabel]).toEqual([shifts[1]!.start, shifts[1]!.end, chairs[2]!.label]);
    expect([doc.movedFrom!.date, String(doc.movedFrom!.shiftId), String(doc.movedFrom!.chairId)]).toEqual([date, shifts[0]!.id, chairs[0]!.id]);
    expect(await isSlotFree(centre.id, chairs[0]!.id, shifts[0]!.id, date)).toBe(true);
    const audit = await AuditEntry.findOne({ action: 'session.move' });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit!.details)).toContain(to);
    const again = await desk.agent.post(`${base}/sessions/${s.id}/move`).send({ date: addDays(today, 3), shiftId: shifts[1]!.id, chairId: chairs[2]!.id });
    expect(again.status).toBe(200);
    expect((await Session.findById(s.id))!.movedFrom!.date).toBe(date);
  });

  it('409 slot_taken on a taken slot; 409 session_exists when the patient already sits in that block', async () => {
    const { base, desk, chairs, shifts, today, mk, centre } = await setup();
    const date = addDays(today, 1);
    const s = await mk({ date });
    const other = await makePatient(centre.id);
    await mk({ date, chair: 1, patientId: other.patient.id });
    const taken = await desk.agent.post(`${base}/sessions/${s.id}/move`).send({ date, shiftId: shifts[0]!.id, chairId: chairs[1]!.id });
    expect([taken.status, taken.body.error]).toEqual([409, 'slot_taken']);
    await mk({ date: addDays(today, 2), shift: 1, chair: 3 });
    const mine = await desk.agent
      .post(`${base}/sessions/${s.id}/move`)
      .send({ date: addDays(today, 2), shiftId: shifts[1]!.id, chairId: chairs[2]!.id });
    expect([mine.status, mine.body.error]).toEqual([409, 'session_exists']);
    expect((await Session.findById(s.id))!.detached).toBe(false);
  });

  it('refuses past dates, non-scheduled sessions, foreign chairs and non-working days', async () => {
    const { base, desk, chairs, shifts, today, mk, centre } = await setup();
    const s = await mk({ date: addDays(today, 1) });
    const url = `${base}/sessions/${s.id}/move`;
    const body = { date: addDays(today, 2), shiftId: shifts[1]!.id, chairId: chairs[2]!.id };
    expect((await desk.agent.post(url).send({ ...body, date: addDays(today, -1) })).status).toBe(400);
    const done = await mk({ date: addDays(today, 4), status: 'cancelled' });
    expect((await desk.agent.post(`${base}/sessions/${done.id}/move`).send(body)).body.error).toBe('bad_status');
    const foreign = await makeCentre();
    expect((await desk.agent.post(url).send({ ...body, chairId: foreign.chairs[0]!.id })).status).toBe(404);
    centre.workingDays = ALL_DAYS.filter((d) => d !== weekdayOf(body.date));
    await centre.save();
    const off = await desk.agent.post(url).send(body);
    expect([off.status, off.body.error]).toEqual([400, 'not_working_day']);
  });

  it('is forbidden for a nurse (no schedule.book)', async () => {
    const { base, nurse, chairs, shifts, today, mk } = await setup();
    const s = await mk({ date: addDays(today, 1) });
    const res = await nurse.agent.post(`${base}/sessions/${s.id}/move`).send({ date: addDays(today, 2), shiftId: shifts[1]!.id, chairId: chairs[2]!.id });
    expect(res.status).toBe(403);
  });

  it('regeneration does not recreate the original date after a move', async () => {
    const { base, desk, chairs, shifts, today, patient } = await setup();
    const date = addDays(today, 1);
    const plan = await desk.agent
      .post(`${base}/patients/${patient.id}/plan`)
      .send({ items: [{ weekday: weekdayOf(date), chairId: chairs[0]!.id, shiftId: shifts[0]!.id }], from: today, repeat: 'weekly' });
    expect(plan.status).toBe(201);
    const s = (await Session.findOne({ patientId: patient.id, date }))!;
    const to = addDays(today, 2);
    const moved = await desk.agent.post(`${base}/sessions/${s.id}/move`).send({ date: to, shiftId: shifts[1]!.id, chairId: chairs[1]!.id });
    expect(moved.status).toBe(200);
    await regenerateSessions(patient.id, today);
    expect(await Session.countDocuments({ patientId: patient.id, date, shiftId: shifts[0]!.id })).toBe(0);
    expect(await Session.countDocuments({ patientId: patient.id, date: to })).toBe(1);
  });
});
