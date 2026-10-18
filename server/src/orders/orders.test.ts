import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { AuditEntry } from '../audit/audit.model.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { Session } from '../sessions/session.model.js';
import { ALL_DAYS, createUser, login, makeCentre, makePatient, staffIn } from '../../test/factories.js';

beforeEach(seedRoles);

async function setup() {
  const { centre, chairs, shifts } = await makeCentre({ name: 'Alpha', workingDays: ALL_DAYS });
  const base = `/api/centres/${centre.id}`;
  const nurse = await staffIn(centre.id, ['nurse']);
  const desk = await staffIn(centre.id, ['front_desk']);
  const doctor = await staffIn(centre.id, ['doctor']);
  const { patient } = await makePatient(centre.id);
  const res = await desk.agent
    .post(`${base}/patients/${patient.id}/plan`)
    .send({ items: [{ weekday: weekdayOf(todayLocal()), chairId: chairs[0]!.id, shiftId: shifts[0]!.id }], from: todayLocal(), repeat: 'weekly' });
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
