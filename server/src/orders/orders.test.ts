import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { AuditEntry } from '../audit/audit.model.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { Patient } from '../patients/patient.model.js';
import { Session } from '../sessions/session.model.js';
import { createUser, login, makeCentre, makePatient, staffIn } from '../../test/factories.js';

beforeEach(seedRoles);

async function setup() {
  const { centre, chairs, shifts } = await makeCentre({ name: 'Alpha' });
  const base = `/api/centres/${centre.id}`;
  const nurse = await staffIn(centre.id, ['nurse']);
  const desk = await staffIn(centre.id, ['front_desk']);
  const doctor = await staffIn(centre.id, ['doctor']);
  const { patient } = await makePatient(centre.id);
  const res = await desk.agent
    .post(`${base}/patients/${patient.id}/pattern`)
    .send({ chairId: chairs[0]!.id, shiftId: shifts[0]!.id, weekdays: [weekdayOf(todayLocal())], from: todayLocal() });
  expect(res.status).toBe(201);
  const session = (await Session.findOne({ patientId: patient.id, date: todayLocal() }))!;
  return { centre, chairs, shifts, base, nurse, desk, doctor, patient, session };
}

describe('doctor orders', () => {
  it('doctor writes an order; nurse sees it on the session and the card; ending removes it', async () => {
    const { base, nurse, desk, doctor, patient, session } = await setup();
    const none = await nurse.agent.get(`${base}/sessions/${session.id}`);
    expect(none.status).toBe(200);
    expect(none.body.orders).toEqual([]);
    expect(none.body.hasActiveOrders).toBe(false);

    const created = await doctor.agent.post(`${base}/patients/${patient.id}/orders`).send({ text: '  heparin-free ' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ text: 'heparin-free', from: todayLocal(), status: 'active', doctor: { id: doctor.user.id } });

    const got = await nurse.agent.get(`${base}/sessions/${session.id}`);
    expect(got.body.orders.map((o: { text: string }) => o.text)).toEqual(['heparin-free']);
    expect(got.body.hasActiveOrders).toBe(true);
    expect((await desk.agent.get(`${base}/patients/${patient.id}/orders`)).status).toBe(403);
    const nurseList = await nurse.agent.get(`${base}/patients/${patient.id}/orders?status=active`);
    expect(nurseList.body).toHaveLength(1);

    const ended = await doctor.agent.post(`${base}/patients/${patient.id}/orders/${created.body.id}/end`);
    expect(ended.status).toBe(200);
    expect(ended.body.status).toBe('ended');
    expect((await doctor.agent.post(`${base}/patients/${patient.id}/orders/${created.body.id}/end`)).body.error).toBe('already_ended');
    const after = await nurse.agent.get(`${base}/sessions/${session.id}`);
    expect(after.body.orders).toEqual([]);
    expect(after.body.hasActiveOrders).toBe(false);
    expect((await nurse.agent.get(`${base}/patients/${patient.id}/orders?status=ended`)).body).toHaveLength(1);
    expect(await AuditEntry.countDocuments({ action: { $in: ['order.create', 'order.end'] } })).toBe(2);
  });

  it('future-dated orders are not active yet; nurse cannot write; validation', async () => {
    const { base, nurse, doctor, patient, session } = await setup();
    expect((await nurse.agent.post(`${base}/patients/${patient.id}/orders`).send({ text: 'x' })).status).toBe(403);
    expect((await doctor.agent.post(`${base}/patients/${patient.id}/orders`).send({ text: '   ' })).status).toBe(400);
    expect((await doctor.agent.post(`${base}/patients/${patient.id}/orders`).send({ text: 'x', from: 'nope' })).status).toBe(400);
    for (const from of ['2026-02-31', '2026-13-01', '2026-04-31']) {
      expect((await doctor.agent.post(`${base}/patients/${patient.id}/orders`).send({ text: 'x', from })).status, from).toBe(400);
    }
    await doctor.agent.post(`${base}/patients/${patient.id}/orders`).send({ text: 'later', from: addDays(todayLocal(), 3) });
    const got = await nurse.agent.get(`${base}/sessions/${session.id}`);
    expect(got.body.orders).toEqual([]);
    expect(got.body.hasActiveOrders).toBe(false);
  });

  it('a doctor linked to two centres uses each centre route; other centre patients are 404', async () => {
    const a = await setup();
    const b = await makeCentre({ name: 'Beta' });
    const { patient: pb } = await makePatient(b.centre.id);
    const user = await createUser({
      username: 'dr-two',
      memberships: [
        { centreId: a.centre.id, roleKeys: ['doctor'] },
        { centreId: b.centre.id, roleKeys: ['doctor'] },
      ],
    });
    const agent = await login(user.username);
    const baseB = `/api/centres/${b.centre.id}`;
    expect((await agent.post(`${a.base}/patients/${a.patient.id}/orders`).send({ text: 'A order' })).status).toBe(201);
    expect((await agent.post(`${baseB}/patients/${pb.id}/orders`).send({ text: 'B order' })).status).toBe(201);
    expect((await agent.get(`${a.base}/patients/${a.patient.id}/orders`)).body.map((o: { text: string }) => o.text)).toEqual(['A order']);
    expect((await agent.get(`${baseB}/patients/${pb.id}/orders`)).body.map((o: { text: string }) => o.text)).toEqual(['B order']);
    expect((await agent.get(`${a.base}/patients/${pb.id}/orders`)).status).toBe(404);
    expect((await agent.post(`${baseB}/patients/${a.patient.id}/orders`).send({ text: 'x' })).status).toBe(404);
  });
});

describe('patient session history', () => {
  it('follows the patient across centres, newest first, excludes scheduled, paginates', async () => {
    const { centre, chairs, shifts, base, doctor, desk, patient } = await setup();
    const other = await makeCentre({ name: 'Beta' });
    const mk = (centreId: unknown, chairId: unknown, shiftId: unknown, date: string, status: string) =>
      Session.create({ centreId, patientId: patient._id, date, chairId, shiftId, status });
    await mk(other.centre._id, other.chairs[0]!._id, other.shifts[0]!._id, '2026-01-01', 'completed');
    await mk(centre._id, chairs[0]!._id, shifts[1]!._id, '2026-01-03', 'completed');
    await mk(centre._id, chairs[0]!._id, shifts[0]!._id, '2026-01-03', 'missed');
    await mk(centre._id, chairs[0]!._id, shifts[0]!._id, '2026-01-02', 'postponed');
    const url = `${base}/patients/${patient.id}/sessions`;
    const res = await doctor.agent.get(url);
    expect(res.status).toBe(200);
    // today's session is still scheduled so is excluded
    expect(res.body.map((s: { date: string; status: string }) => `${s.date}:${s.status}`)).toEqual([
      '2026-01-03:completed',
      '2026-01-03:missed',
      '2026-01-02:postponed',
      '2026-01-01:completed',
    ]);
    expect(res.body[3].centreName).toBe('Beta');
    expect(res.body[3].centreId).toBe(String(other.centre._id));
    expect(res.body[0].centreId).toBe(String(centre._id));
    expect(res.body[0].centreName).toBe('Alpha');
    expect(res.body[0]).toMatchObject({ usage: [], notes: [], vitals: { bp: [] } });
    expect((await desk.agent.get(url)).status).toBe(200);

    const page = await doctor.agent.get(`${url}?before=2026-01-03&limit=1`);
    expect(page.body.map((s: { date: string }) => s.date)).toEqual(['2026-01-02']);
    expect((await doctor.agent.get(`${url}?limit=0`)).status).toBe(400);
    expect((await doctor.agent.get(`${url}?limit=51`)).status).toBe(400);
    expect((await doctor.agent.get(`${url}?before=bad`)).status).toBe(400);

    await Patient.updateOne({ _id: patient._id }, { $set: { centreId: other.centre._id } });
    expect((await doctor.agent.get(url)).status).toBe(404);
  });
});
