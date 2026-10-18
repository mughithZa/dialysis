import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { Item } from '../catalog/item.model.js';
import { Unit } from '../catalog/unit.model.js';
import { Centre } from '../centres/centre.model.js';
import { addDays, localDateTime, todayLocal } from '../lib/dates.js';
import { PatientNote } from '../notes/patient-note.model.js';
import { RosterEntry } from '../schedule/roster.model.js';
import { UsageLine } from './usage.model.js';
import { Session } from './session.model.js';
import { Order } from '../orders/order.model.js';
import { login, makeCentre, makePatient, makeSession, staffIn } from '../../test/factories.js';

beforeAll(async () => {
  await Item.init();
  await Unit.init();
});
beforeEach(seedRoles);

async function setup() {
  const { centre, chairs, shifts } = await makeCentre({ name: 'North' });
  const { patient, user } = await makePatient(centre.id);
  const desk = await staffIn(centre.id, ['front_desk']);
  const nurse = await staffIn(centre.id, ['nurse']);
  const doctor = await staffIn(centre.id, ['doctor']);
  const today = todayLocal();
  const mk = (date: string, status: string, extra: object = {}) =>
    makeSession({ centreId: centre._id, patientId: patient._id, date, chairId: chairs[0]!._id, shiftId: shifts[0]!._id, status, ...extra });
  return { centre, chairs, shifts, patient, user, desk, nurse, doctor, today, mk, url: `/api/centres/${centre.id}/patients/${patient.id}` };
}

describe('GET patients/:id/timeline', () => {
  it('splits upcoming, today and past', async () => {
    const { desk, mk, today, url } = await setup();
    await mk(addDays(today, 14), 'scheduled');
    await mk(addDays(today, 13), 'scheduled');
    await mk(addDays(today, 1), 'scheduled');
    await mk(today, 'active');
    await mk(addDays(today, -1), 'missed', { statusReason: 'sick' });
    await mk(addDays(today, -5), 'completed');
    const res = await desk.agent.get(`${url}/timeline`);
    expect(res.status).toBe(200);
    expect(res.body.upcoming.map((i: { date: string }) => i.date)).toEqual([addDays(today, 1), addDays(today, 13)]);
    expect(res.body.today.map((i: { status: string }) => i.status)).toEqual(['active']);
    expect(res.body.past.map((i: { date: string }) => i.date)).toEqual([addDays(today, -1), addDays(today, -5)]);
    expect(res.body.past[0]).toMatchObject({ statusReason: 'sick', block: 'Morning', start: '07:00', end: '11:30', centreName: 'North', linkable: true });
  });

  it('pages the past by before and limit; upcoming only on the first page', async () => {
    const { desk, mk, today, url } = await setup();
    await mk(addDays(today, 2), 'scheduled');
    for (const n of [1, 2, 3]) await mk(addDays(today, -n), 'completed');
    const p1 = await desk.agent.get(`${url}/timeline?limit=2`);
    expect(p1.body.past.map((i: { date: string }) => i.date)).toEqual([addDays(today, -1), addDays(today, -2)]);
    expect(p1.body.upcoming).toHaveLength(1);
    const p2 = await desk.agent.get(`${url}/timeline?limit=2&before=${addDays(today, -2)}`);
    expect(p2.body.past.map((i: { date: string }) => i.date)).toEqual([addDays(today, -3)]);
    expect(p2.body.upcoming).toEqual([]);
    expect(p2.body.today).toEqual([]);
    expect((await desk.agent.get(`${url}/timeline?limit=51`)).status).toBe(400);
  });

  it('windows notes by the page: page 2 holds only notes inside its own date span', async () => {
    const { desk, doctor, patient, centre, mk, today, url } = await setup();
    for (const n of [1, 2, 3, 4, 5]) await mk(addDays(today, -n), 'completed');
    const note = (daysAgo: number, text: string) =>
      PatientNote.create({ patientId: patient._id, centreId: centre._id, authorId: doctor.user._id, text, at: localDateTime(addDays(today, -daysAgo), '12:00') });
    for (const [d, t] of [[1, 'd1'], [2, 'd2'], [3, 'd3'], [4, 'd4'], [5, 'd5'], [40, 'd40']] as const) await note(d, t);
    const texts = (r: { body: { notes: { text: string }[] } }) => r.body.notes.map((n) => n.text);
    const p1 = await desk.agent.get(`${url}/timeline?limit=2`);
    expect(texts(p1)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
    const p2 = await desk.agent.get(`${url}/timeline?limit=2&before=${addDays(today, -2)}`);
    expect(p2.body.past.map((i: { date: string }) => i.date)).toEqual([addDays(today, -3), addDays(today, -4)]);
    expect(texts(p2)).toEqual(['d3', 'd4']);
    const p3 = await desk.agent.get(`${url}/timeline?limit=2&before=${addDays(today, -4)}`);
    expect(p3.body.past.map((i: { date: string }) => i.date)).toEqual([addDays(today, -5)]);
    expect(texts(p3)).toEqual(['d5', 'd40']);
  });

  it('names the nurse: runBy, else rosterNurseId, else the roster for future sessions', async () => {
    const { desk, nurse, doctor, mk, today, url, centre, shifts, chairs } = await setup();
    await mk(addDays(today, -1), 'completed', { runBy: nurse.user._id, rosterNurseId: doctor.user._id });
    await mk(addDays(today, -2), 'missed', { rosterNurseId: doctor.user._id });
    await mk(addDays(today, -3), 'missed');
    await mk(addDays(today, 3), 'scheduled');
    await RosterEntry.create({ centreId: centre._id, nurseId: nurse.user._id, shiftId: shifts[0]!._id, from: addDays(today, -10), to: addDays(today, 10), chairIds: [chairs[0]!._id] });
    const res = await desk.agent.get(`${url}/timeline`);
    // the past session without a frozen nurse stays null even though a roster entry now covers it
    expect(res.body.past.map((i: { nurse: unknown }) => i.nurse)).toEqual([{ name: nurse.user.name }, { name: doctor.user.name }, null]);
    expect(res.body.upcoming[0].nurse).toEqual({ name: nurse.user.name });
  });

  it('lists medicines given, not supplies', async () => {
    const { desk, nurse, mk, today, url } = await setup();
    const unit = await Unit.create({ name: 'cc' });
    const med = await Item.create({ name: 'Heparin', type: 'medicine', unitId: unit._id, status: 'approved', createdBy: nurse.user._id });
    const sup = await Item.create({ name: 'Gauze', type: 'supply', unitId: unit._id, status: 'approved', createdBy: nurse.user._id });
    const s = await mk(addDays(today, -1), 'completed');
    await UsageLine.create({ sessionId: s._id, patientId: s.patientId, centreId: s.centreId, date: s.date, itemId: med._id, amount: 5, by: nurse.user._id });
    await UsageLine.create({ sessionId: s._id, patientId: s.patientId, centreId: s.centreId, date: s.date, itemId: sup._id, amount: 2, by: nurse.user._id });
    const res = await desk.agent.get(`${url}/timeline`);
    expect(res.body.past[0].medicines).toEqual([{ name: 'Heparin', amount: 5, unit: 'cc' }]);
    expect(res.body.past[0].oneOff).toBe(false);
    await Session.updateOne({ _id: s._id }, { $set: { oneOff: true } });
    expect((await desk.agent.get(`${url}/timeline`)).body.past[0].oneOff).toBe(true);
  });

  it('shows old-centre sessions after a transfer as not linkable', async () => {
    const { desk, patient, mk, today, url } = await setup();
    const other = await makeCentre({ name: 'South' });
    await mk(addDays(today, -4), 'completed');
    patient.centreId = other.centre._id;
    await patient.save();
    const south = await staffIn(other.centre.id, ['front_desk']);
    await makeSession({ centreId: other.centre._id, patientId: patient._id, date: addDays(today, -1), chairId: other.chairs[0]!._id, shiftId: other.shifts[0]!._id, status: 'completed' });
    const res = await south.agent.get(`/api/centres/${other.centre.id}/patients/${patient.id}/timeline`);
    expect(res.body.past.map((i: { centreName: string; linkable: boolean }) => [i.centreName, i.linkable])).toEqual([['South', true], ['North', false]]);
    expect((await desk.agent.get(`${url}/timeline`)).status).toBe(404);
  });
});

describe('GET /api/me/timeline', () => {
  it('hides notes when the centre setting is off and exposes no staff ids', async () => {
    const { user, doctor, mk, today, patient, centre, nurse } = await setup();
    await mk(addDays(today, -1), 'completed', { runBy: nurse.user._id });
    await doctor.agent.post(`/api/centres/${centre.id}/patients/${patient.id}/notes`).send({ text: 'watch BP' });
    const agent = await login(user.username);
    const off = await agent.get('/api/me/timeline');
    expect(off.status).toBe(200);
    expect(off.body.notes).toEqual([]);
    expect(off.body.past[0].nurse).toEqual({ name: nurse.user.name });
    expect(JSON.stringify(off.body)).not.toContain(String(nurse.user._id));
    expect(off.body.past[0].linkable).toBeUndefined();
    await Centre.updateOne({ _id: centre._id }, { $set: { 'settings.patientsSeeNotes': true } });
    const on = await agent.get('/api/me/timeline');
    expect(on.body.notes).toHaveLength(1);
    expect(on.body.notes[0]).toMatchObject({ text: 'watch BP', author: { name: doctor.user.name } });
    expect(Object.keys(on.body.notes[0].author)).toEqual(['name']);
    expect(JSON.stringify(on.body)).not.toContain(String(doctor.user._id));
  });

  it('with seeNotes, each item carries the session notes and the orders in force that date; none when off', async () => {
    const { user, doctor, nurse, mk, today, patient, centre } = await setup();
    const s = await mk(addDays(today, -1), 'completed');
    s.notes.push({ at: new Date(), by: nurse.user._id, text: 'felt dizzy' } as never);
    await s.save();
    await mk(addDays(today, -10), 'completed');
    await Order.create({ patientId: patient._id, centreId: centre._id, doctorId: doctor.user._id, text: 'no heparin', from: addDays(today, -5) });
    await Order.create({ patientId: patient._id, centreId: centre._id, doctorId: doctor.user._id, text: 'old', from: addDays(today, -20), status: 'ended' });
    const agent = await login(user.username);
    const off = await agent.get('/api/me/timeline');
    expect(off.body.past[0]).not.toHaveProperty('notes');
    expect(off.body.past[0]).not.toHaveProperty('orders');
    await Centre.updateOne({ _id: centre._id }, { $set: { 'settings.patientsSeeNotes': true } });
    const on = await agent.get('/api/me/timeline');
    expect(on.body.past[0].notes).toEqual([{ at: expect.any(String), text: 'felt dizzy' }]);
    expect(on.body.past[0].orders).toEqual([{ text: 'no heparin', from: addDays(today, -5) }]);
    expect(on.body.past[1].notes).toEqual([]);
    expect(on.body.past[1].orders).toEqual([]);
    expect(JSON.stringify(on.body)).not.toContain(String(nurse.user._id));
    // staff viewers keep the plain item (they open the session for notes)
    const desk = await staffIn(centre.id, ['front_desk']);
    const staff = await desk.agent.get(`/api/centres/${centre.id}/patients/${patient.id}/timeline`);
    expect(staff.body.past[0]).not.toHaveProperty('notes');
  });
});
