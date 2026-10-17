import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { AuditEntry } from '../audit/audit.model.js';
import { Pattern } from './pattern.model.js';
import { Slot } from './slot.model.js';
import { addDays, todayLocal } from '../lib/dates.js';
import { makeCentre, makePatient, staffIn } from '../../test/factories.js';

beforeEach(seedRoles);

const from = () => todayLocal();
async function setup() {
  const { centre, chairs, shifts } = await makeCentre();
  const { agent } = await staffIn(centre.id, ['front_desk']);
  const base = `/api/centres/${centre.id}`;
  const book = (patientId: string, o: object = {}) =>
    agent.post(`${base}/patients/${patientId}/pattern`).send({
      chairId: chairs[0]!.id,
      shiftId: shifts[0]!.id,
      weekdays: [6, 1, 3],
      from: from(),
      ...o,
    });
  return { centre, chairs, shifts, agent, base, book };
}

describe('weekly booking', () => {
  it('books Sat/Mon/Wed morning chair 1; grid shows 3 slots; audited', async () => {
    const { centre, chairs, shifts, agent, base, book } = await setup();
    const { patient } = await makePatient(centre.id);
    const res = await book(patient.id);
    expect(res.status).toBe(201);
    const grid = await agent.get(`${base}/schedule/grid`);
    expect(grid.status).toBe(200);
    expect(grid.body.chairs).toHaveLength(4);
    expect(grid.body.shifts).toHaveLength(2);
    expect(grid.body.slots).toHaveLength(3);
    expect(grid.body.slots.map((s: { weekday: number }) => s.weekday).sort()).toEqual([1, 3, 6]);
    expect(grid.body.slots[0]).toMatchObject({
      chairId: chairs[0]!.id,
      shiftId: shifts[0]!.id,
      patient: { id: patient.id, name: patient.name },
    });
    expect(await AuditEntry.countDocuments({ action: 'pattern.create' })).toBe(1);
  });

  it('another patient on the same chair/shift/day gets 409 slot_taken and nothing is inserted', async () => {
    const { centre, book } = await setup();
    const a = await makePatient(centre.id);
    const b = await makePatient(centre.id);
    expect((await book(a.patient.id)).status).toBe(201);
    const res = await book(b.patient.id, { weekdays: [2, 1] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slot_taken');
    expect(await Slot.countDocuments()).toBe(3);
    expect(await Pattern.countDocuments()).toBe(1);
  });

  it('concurrent bookings of the same slot: exactly one wins', async () => {
    const { centre, book } = await setup();
    const a = await makePatient(centre.id);
    const b = await makePatient(centre.id);
    const rs = await Promise.all([book(a.patient.id, { weekdays: [1] }), book(b.patient.id, { weekdays: [1] })]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await Slot.countDocuments()).toBe(1);
  });

  it('validates weekdays, from, ids and state', async () => {
    const { centre, book } = await setup();
    const { patient } = await makePatient(centre.id);
    expect((await book(patient.id, { weekdays: [] })).status).toBe(400);
    expect((await book(patient.id, { weekdays: [0, 1, 2, 3] })).status).toBe(400);
    expect((await book(patient.id, { weekdays: [1, 1] })).status).toBe(400);
    expect((await book(patient.id, { from: undefined })).status).toBe(400);
    const past = await book(patient.id, { from: addDays(from(), -1) });
    expect(past.status).toBe(400);
    expect(past.body.error).toBe('from_in_past');
    expect((await book(patient.id, { chairId: 'nope' })).status).toBe(404);
    expect(await Slot.countDocuments()).toBe(0);
  });

  it('chair/shift of another centre is 404; inactive is 400', async () => {
    const { centre, chairs, shifts, book } = await setup();
    const other = await makeCentre();
    const { patient } = await makePatient(centre.id);
    expect((await book(patient.id, { chairId: other.chairs[0]!.id })).status).toBe(404);
    expect((await book(patient.id, { shiftId: other.shifts[0]!.id })).status).toBe(404);
    chairs[1]!.active = false;
    await chairs[1]!.save();
    shifts[1]!.active = false;
    await shifts[1]!.save();
    expect((await book(patient.id, { chairId: chairs[1]!.id })).body.error).toBe('inactive_chair');
    expect((await book(patient.id, { shiftId: shifts[1]!.id })).body.error).toBe('inactive_shift');
  });

  it('second booking for the same patient is 409 already_booked; patient of another centre is 404', async () => {
    const { centre, book } = await setup();
    const { patient } = await makePatient(centre.id);
    expect((await book(patient.id)).status).toBe(201);
    expect((await book(patient.id, { weekdays: [2] })).body.error).toBe('already_booked');
    const other = await makeCentre();
    const foreign = await makePatient(other.centre.id);
    expect((await book(foreign.patient.id)).status).toBe(404);
  });

  it('requires schedule.book', async () => {
    const { centre, chairs, shifts } = await setup();
    const { patient } = await makePatient(centre.id);
    const { agent } = await staffIn(centre.id, ['nurse']);
    const res = await agent
      .post(`/api/centres/${centre.id}/patients/${patient.id}/pattern`)
      .send({ chairId: chairs[0]!.id, shiftId: shifts[0]!.id, weekdays: [1], from: from() });
    expect(res.status).toBe(403);
  });
});

describe('shift change', () => {
  const change = (agent: Awaited<ReturnType<typeof setup>>['agent'], base: string, id: string, o: object) =>
    agent.put(`${base}/patients/${id}/pattern`).send(o);

  it('moves to afternoon from a date: old pattern ends the day before, old slots freed, new held', async () => {
    const { centre, chairs, shifts, agent, base, book } = await setup();
    const { patient } = await makePatient(centre.id);
    await book(patient.id);
    const start = addDays(from(), 7);
    const res = await change(agent, base, patient.id, {
      chairId: chairs[0]!.id,
      shiftId: shifts[1]!.id,
      weekdays: [6, 1, 3],
      from: start,
    });
    expect(res.status).toBe(200);
    const patterns = await Pattern.find({ patientId: patient.id }).sort({ from: 1 });
    expect(patterns).toHaveLength(2);
    expect(patterns[0]!.to).toBe(addDays(start, -1));
    expect(patterns[1]!.to).toBeNull();
    const slots = await Slot.find();
    expect(slots).toHaveLength(3);
    expect(slots.every((s) => String(s.shiftId) === shifts[1]!.id)).toBe(true);
    expect(await AuditEntry.countDocuments({ action: 'pattern.change' })).toBe(1);
  });

  it('into a taken slot is 409 and the old pattern stays open and intact', async () => {
    const { centre, chairs, shifts, agent, base, book } = await setup();
    const a = await makePatient(centre.id);
    const b = await makePatient(centre.id);
    await book(a.patient.id);
    await book(b.patient.id, { shiftId: shifts[1]!.id, weekdays: [1] });
    const res = await change(agent, base, a.patient.id, {
      chairId: chairs[0]!.id,
      shiftId: shifts[1]!.id,
      weekdays: [1, 2],
      from: from(),
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slot_taken');
    const open = await Pattern.find({ patientId: a.patient.id });
    expect(open).toHaveLength(1);
    expect(open[0]!.to).toBeNull();
    expect(await Slot.countDocuments({ patternId: open[0]!._id })).toBe(3);
  });

  it('can reuse its own current slots; no open pattern is 409 no_pattern', async () => {
    const { centre, chairs, shifts, agent, base, book } = await setup();
    const { patient } = await makePatient(centre.id);
    const body = { chairId: chairs[0]!.id, shiftId: shifts[0]!.id, weekdays: [1], from: from() };
    const none = await change(agent, base, patient.id, body);
    expect(none.status).toBe(409);
    expect(none.body.error).toBe('no_pattern');
    await book(patient.id);
    expect((await change(agent, base, patient.id, body)).status).toBe(200);
  });
});

describe('discharge', () => {
  it('transplant frees slots, marks discharged, audited; booking afterwards is 409', async () => {
    const { centre, agent, base, book } = await setup();
    const { patient } = await makePatient(centre.id);
    await book(patient.id);
    const date = addDays(from(), 3);
    const res = await agent.post(`${base}/patients/${patient.id}/discharge`).send({ reason: 'transplant', date });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('discharged');
    expect(res.body.discharge).toEqual({ reason: 'transplant', date });
    expect(await Slot.countDocuments()).toBe(0);
    expect((await Pattern.findOne({ patientId: patient.id }))!.to).toBe(date);
    expect(await AuditEntry.countDocuments({ action: 'patient.discharge' })).toBe(1);
    const again = await book(patient.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('patient_not_active');
  });

  it('validates reason and date; already discharged is 409', async () => {
    const { centre, agent, base } = await setup();
    const { patient } = await makePatient(centre.id);
    const url = `${base}/patients/${patient.id}/discharge`;
    expect((await agent.post(url).send({ reason: 'bogus', date: from() })).status).toBe(400);
    expect((await agent.post(url).send({ reason: 'moved' })).status).toBe(400);
    expect((await agent.post(url).send({ reason: 'moved', date: '18/10/2026' })).status).toBe(400);
    expect((await agent.post(url).send({ reason: 'moved', date: from() })).status).toBe(200);
    expect((await agent.post(url).send({ reason: 'moved', date: from() })).status).toBe(409);
  });
});

describe('open pattern invariants', () => {
  it('concurrent bookings for the same patient: exactly one wins with already_booked', async () => {
    const { centre, book } = await setup();
    const { patient } = await makePatient(centre.id);
    const rs = await Promise.all([book(patient.id, { weekdays: [1] }), book(patient.id, { weekdays: [2] })]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(rs.find((r) => r.status === 409)!.body.error).toBe('already_booked');
    expect(await Pattern.countDocuments({ patientId: patient.id, to: null })).toBe(1);
  });

  it('the database refuses a second open pattern', async () => {
    const { centre, chairs, shifts } = await setup();
    const { patient } = await makePatient(centre.id);
    await Pattern.init();
    const doc = { centreId: centre.id, patientId: patient.id, chairId: chairs[0]!.id, shiftId: shifts[0]!.id, weekdays: [1], from: from() };
    await Pattern.create(doc);
    await expect(Pattern.create(doc)).rejects.toMatchObject({ code: 11000 });
    await Pattern.create({ ...doc, to: from() }); // closed patterns are unlimited
  });

  it('changing from a date on or before the open pattern start replaces it instead of inverting the range', async () => {
    const { centre, chairs, shifts, agent, base, book } = await setup();
    const { patient } = await makePatient(centre.id);
    const start = addDays(from(), 3);
    await book(patient.id, { from: start });
    const res = await agent.put(`${base}/patients/${patient.id}/pattern`).send({
      chairId: chairs[0]!.id, shiftId: shifts[1]!.id, weekdays: [2], from: start,
    });
    expect(res.status).toBe(200);
    const patterns = await Pattern.find({ patientId: patient.id });
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.to).toBeNull();
    expect(String(patterns[0]!.shiftId)).toBe(shifts[1]!.id);
    expect(await Slot.countDocuments()).toBe(1);
  });
});
