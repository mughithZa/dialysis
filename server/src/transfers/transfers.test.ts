import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { AuditEntry } from '../audit/audit.model.js';
import { Order } from '../orders/order.model.js';
import { Patient } from '../patients/patient.model.js';
import { Slot } from '../schedule/slot.model.js';
import { Session } from '../sessions/session.model.js';
import { todayLocal, weekdayOf, addDays } from '../lib/dates.js';
import { makeCentre, makePatient, staffIn } from '../../test/factories.js';
import { Transfer } from './transfer.model.js';

beforeAll(async () => {
  await Transfer.init();
});
beforeEach(seedRoles);

async function setup() {
  const a = await makeCentre({ name: 'Alpha' });
  const b = await makeCentre({ name: 'Beta' });
  const deskA = await staffIn(a.centre.id, ['front_desk']);
  const deskB = await staffIn(b.centre.id, ['front_desk']);
  const { patient } = await makePatient(a.centre.id, { phone: '555', kidneyFailureCause: 'diabetes' });
  const baseA = `/api/centres/${a.centre.id}`;
  const baseB = `/api/centres/${b.centre.id}`;
  const send = (note?: string) =>
    deskA.agent.post(`${baseA}/patients/${patient.id}/transfer`).send({ toCentreId: b.centre.id, note });
  return { a, b, deskA, deskB, patient, baseA, baseB, send };
}

async function book(s: Awaited<ReturnType<typeof setup>>, from = todayLocal()) {
  const res = await s.deskA.agent
    .post(`${s.baseA}/patients/${s.patient.id}/pattern`)
    .send({ chairId: s.a.chairs[0]!.id, shiftId: s.a.shifts[0]!.id, weekdays: [weekdayOf(from)], from });
  expect(res.status).toBe(201);
}

describe('sending', () => {
  it('lists targets without the own centre, marks the patient transferring, keeps it in the old centre', async () => {
    const s = await setup();
    const targets = await s.deskA.agent.get(`${s.baseA}/transfer-targets`);
    expect(targets.body).toEqual([{ id: s.b.centre.id, name: 'Beta' }]);
    const res = await s.send('please');
    expect(res.status).toBe(201);
    expect((await Patient.findById(s.patient.id))!.status).toBe('transferring');
    expect((await s.deskA.agent.get(`${s.baseA}/patients/${s.patient.id}`)).status).toBe(200);
    expect((await s.deskB.agent.get(`${s.baseB}/patients/${s.patient.id}`)).status).toBe(404);
    expect(await AuditEntry.countDocuments({ action: 'transfer.send' })).toBe(1);
  });

  it('default patient list includes transferring; status filter works', async () => {
    const s = await setup();
    await s.send();
    const ids = async (q = '') =>
      (await s.deskA.agent.get(`${s.baseA}/patients${q}`)).body.map((p: { id: string }) => p.id);
    expect(await ids()).toEqual([s.patient.id]);
    expect(await ids('?status=transferring')).toEqual([s.patient.id]);
    expect(await ids('?status=active')).toEqual([]);
    expect(await ids('?status=all')).toEqual([s.patient.id]);
    expect(await ids('?status=discharged')).toEqual([]);
  });

  it('rejects bad targets, non-active patients and a second pending transfer', async () => {
    const s = await setup();
    const url = `${s.baseA}/patients/${s.patient.id}/transfer`;
    const self = await s.deskA.agent.post(url).send({ toCentreId: s.a.centre.id });
    expect([self.status, self.body]).toEqual([400, { error: 'bad_target' }]);
    const closed = await makeCentre();
    closed.centre.status = 'closed';
    await closed.centre.save();
    const c = await s.deskA.agent.post(url).send({ toCentreId: closed.centre.id });
    expect([c.status, c.body]).toEqual([400, { error: 'bad_target' }]);
    expect((await s.send()).status).toBe(201);
    const again = await s.send();
    expect([again.status, again.body]).toEqual([409, { error: 'patient_not_active' }]);
    // the partial unique index is the backstop for a racing second pending transfer
    await expect(
      Transfer.create({ patientId: s.patient._id, fromCentreId: s.a.centre._id, toCentreId: s.b.centre._id, sentBy: s.deskA.user._id }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('blocks discharge and booking changes while pending, but not session running', async () => {
    const s = await setup();
    await book(s);
    await s.send();
    const d = await s.deskA.agent
      .post(`${s.baseA}/patients/${s.patient.id}/discharge`)
      .send({ reason: 'moved', date: todayLocal() });
    expect([d.status, d.body]).toEqual([409, { error: 'transfer_pending' }]);
    const pat = { chairId: s.a.chairs[1]!.id, shiftId: s.a.shifts[0]!.id, weekdays: [1], from: addDays(todayLocal(), 7) };
    const p = await s.deskA.agent.post(`${s.baseA}/patients/${s.patient.id}/pattern`).send(pat);
    expect([p.status, p.body]).toEqual([409, { error: 'transfer_pending' }]);
    const c = await s.deskA.agent.put(`${s.baseA}/patients/${s.patient.id}/pattern`).send(pat);
    expect([c.status, c.body]).toEqual([409, { error: 'transfer_pending' }]);
    const nurse = await staffIn(s.a.centre.id, ['nurse']);
    const today = (await Session.findOne({ patientId: s.patient.id, date: todayLocal() }))!;
    expect((await nurse.agent.post(`${s.baseA}/sessions/${today.id}/open`)).status).toBe(200);
  });
});

describe('cancel', () => {
  it('source only; patient returns to active; second cancel is not_pending', async () => {
    const s = await setup();
    const t = (await s.send()).body as { id: string };
    expect((await s.deskB.agent.post(`${s.baseB}/transfers/${t.id}/cancel`)).status).toBe(404);
    expect((await s.deskA.agent.post(`${s.baseA}/transfers/${t.id}/cancel`)).status).toBe(200);
    expect((await Patient.findById(s.patient.id))!.status).toBe('active');
    const again = await s.deskA.agent.post(`${s.baseA}/transfers/${t.id}/cancel`);
    expect([again.status, again.body]).toEqual([409, { error: 'not_pending' }]);
    expect(await AuditEntry.countDocuments({ action: 'transfer.cancel' })).toBe(1);
  });
});

describe('listing', () => {
  it('incoming shows patient summary and sender; outgoing shows target and status', async () => {
    const s = await setup();
    const t = (await s.send('note!')).body as { id: string };
    const inc = await s.deskB.agent.get(`${s.baseB}/transfers?direction=incoming`);
    expect(inc.status).toBe(200);
    expect(inc.body).toEqual([
      {
        id: t.id,
        status: 'pending',
        sentAt: expect.any(String),
        fromCentre: { id: s.a.centre.id, name: 'Alpha' },
        note: 'note!',
        patient: { name: s.patient.name, phone: '555', kidneyFailureCause: 'diabetes' },
      },
    ]);
    const out = await s.deskA.agent.get(`${s.baseA}/transfers?direction=outgoing`);
    expect(out.body[0]).toMatchObject({
      id: t.id,
      status: 'pending',
      toCentre: { id: s.b.centre.id, name: 'Beta' },
      rejectReason: null,
      patient: { id: s.patient.id, name: s.patient.name },
    });
    expect((await s.deskA.agent.get(`${s.baseA}/transfers?direction=incoming`)).body).toEqual([]);
    expect((await s.deskA.agent.get(`${s.baseA}/transfers`)).status).toBe(400);
  });
});

describe('reject', () => {
  it('returns the patient to active with the reason visible in the outgoing list', async () => {
    const s = await setup();
    const t = (await s.send()).body as { id: string };
    expect((await s.deskA.agent.post(`${s.baseA}/transfers/${t.id}/reject`).send({ reason: 'x' })).status).toBe(404);
    expect((await s.deskB.agent.post(`${s.baseB}/transfers/${t.id}/reject`).send({})).status).toBe(400);
    expect((await s.deskB.agent.post(`${s.baseB}/transfers/${t.id}/reject`).send({ reason: 'full' })).status).toBe(200);
    const p = (await Patient.findById(s.patient.id))!;
    expect([String(p.centreId), p.status]).toEqual([s.a.centre.id, 'active']);
    const out = await s.deskA.agent.get(`${s.baseA}/transfers?direction=outgoing`);
    expect(out.body[0]).toMatchObject({ status: 'rejected', rejectReason: 'full', patient: { id: s.patient.id, name: s.patient.name } });
    const again = await s.deskB.agent.post(`${s.baseB}/transfers/${t.id}/accept`);
    expect([again.status, again.body]).toEqual([409, { error: 'not_pending' }]);
    expect((await s.send()).status).toBe(201); // a new transfer can be sent afterwards
  });
});

describe('accept', () => {
  it('moves the patient: old centre loses access, new sees full history, slots freed, orders moved', async () => {
    const s = await setup();
    await book(s);
    const doctorA = await staffIn(s.a.centre.id, ['doctor']);
    const doctorB = await staffIn(s.b.centre.id, ['doctor']);
    const nurseA = await staffIn(s.a.centre.id, ['nurse']);
    const today = (await Session.findOne({ patientId: s.patient.id, date: todayLocal() }))!;
    expect((await nurseA.agent.post(`${s.baseA}/sessions/${today.id}/open`)).status).toBe(200);
    expect((await nurseA.agent.post(`${s.baseA}/sessions/${today.id}/close`)).status).toBe(200);
    const future = await Session.create({
      centreId: s.a.centre._id, patientId: s.patient._id, date: addDays(todayLocal(), 7),
      chairId: s.a.chairs[0]!._id, shiftId: s.a.shifts[1]!._id, status: 'scheduled',
    });
    const todayScheduled = await Session.create({
      centreId: s.a.centre._id, patientId: s.patient._id, date: todayLocal(),
      chairId: s.a.chairs[1]!._id, shiftId: s.a.shifts[1]!._id, status: 'scheduled',
    });
    const active = await Order.create({
      patientId: s.patient._id, centreId: s.a.centre._id, doctorId: doctorA.user._id, text: 'o', from: todayLocal(),
    });
    const ended = await Order.create({
      patientId: s.patient._id, centreId: s.a.centre._id, doctorId: doctorA.user._id, text: 'e', from: todayLocal(), status: 'ended',
    });

    const t = (await s.send()).body as { id: string };
    expect((await s.deskA.agent.post(`${s.baseA}/transfers/${t.id}/accept`)).status).toBe(404);
    expect((await s.deskB.agent.post(`${s.baseB}/transfers/${t.id}/accept`)).status).toBe(200);

    const p = (await Patient.findById(s.patient.id))!;
    expect([String(p.centreId), p.status]).toEqual([s.b.centre.id, 'active']);
    expect((await s.deskA.agent.get(`${s.baseA}/patients/${s.patient.id}`)).status).toBe(404);
    expect((await doctorA.agent.get(`${s.baseA}/patients/${s.patient.id}`)).status).toBe(404);
    expect((await doctorB.agent.get(`${s.baseB}/patients/${s.patient.id}`)).status).toBe(200);
    const hist = await doctorB.agent.get(`${s.baseB}/patients/${s.patient.id}/sessions`);
    expect(hist.status).toBe(200);
    expect(hist.body.map((h: { centreName: string }) => h.centreName)).toEqual(['Alpha']);
    expect(await Slot.countDocuments({ centreId: s.a.centre._id })).toBe(0);
    expect(await Session.exists({ _id: future._id })).toBeNull();
    expect(await Session.exists({ _id: todayScheduled._id })).toBeNull();
    expect(await Session.exists({ _id: today._id })).not.toBeNull();
    expect(String((await Order.findById(active._id))!.centreId)).toBe(s.b.centre.id);
    expect(String((await Order.findById(ended._id))!.centreId)).toBe(s.a.centre.id);
    const out = await s.deskA.agent.get(`${s.baseA}/transfers?direction=outgoing`);
    expect(out.body[0].status).toBe('accepted');
    expect(out.body[0].patient).toBeNull(); // the patient now belongs to the other centre
    expect(await AuditEntry.countDocuments({ action: 'transfer.accept' })).toBe(1);
  });

  it('old centre loses session access and /today omits the patient', async () => {
    const s = await setup();
    await book(s);
    const nurseA = await staffIn(s.a.centre.id, ['nurse']);
    const doctorA = await staffIn(s.a.centre.id, ['doctor']);
    const today = (await Session.findOne({ patientId: s.patient.id, date: todayLocal() }))!;
    await nurseA.agent.post(`${s.baseA}/sessions/${today.id}/open`);
    await nurseA.agent.post(`${s.baseA}/sessions/${today.id}/close`);
    const t = (await s.send()).body as { id: string };
    const before = await nurseA.agent.get(`${s.baseA}/today`);
    expect(JSON.stringify(before.body)).toContain(s.patient.id);
    expect((await s.deskB.agent.post(`${s.baseB}/transfers/${t.id}/accept`)).status).toBe(200);
    for (const who of [s.deskA, nurseA, doctorA]) {
      expect((await who.agent.get(`${s.baseA}/sessions/${today.id}`)).status).toBe(404);
    }
    expect((await nurseA.agent.get(`${s.baseA}/sessions/${today.id}/history`)).status).toBe(404);
    expect((await nurseA.agent.post(`${s.baseA}/sessions/${today.id}/notes`).send({ text: 'x' })).status).toBe(404);
    const after = await nurseA.agent.get(`${s.baseA}/today`);
    expect(JSON.stringify(after.body)).not.toContain(s.patient.id);
  });

  it('409 session_active while a session is active, without moving anything', async () => {
    const s = await setup();
    await book(s);
    const nurseA = await staffIn(s.a.centre.id, ['nurse']);
    const today = (await Session.findOne({ patientId: s.patient.id, date: todayLocal() }))!;
    expect((await nurseA.agent.post(`${s.baseA}/sessions/${today.id}/open`)).status).toBe(200);
    const t = (await s.send()).body as { id: string };
    const r = await s.deskB.agent.post(`${s.baseB}/transfers/${t.id}/accept`);
    expect([r.status, r.body]).toEqual([409, { error: 'session_active' }]);
    const p = (await Patient.findById(s.patient.id))!;
    expect([String(p.centreId), p.status]).toEqual([s.a.centre.id, 'transferring']);
    expect((await Transfer.findById(t.id))!.status).toBe('pending');
    expect(await Slot.countDocuments({ centreId: s.a.centre._id })).toBeGreaterThan(0);
  });
});
