import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { AuditEntry } from '../audit/audit.model.js';
import { Session } from '../sessions/session.model.js';
import { markMissed } from '../notify/jobs.js';
import { closeSession, postponeSession } from '../sessions/service.js';
import { RosterEntry } from './roster.model.js';
import { resolveRoster, nurseFor } from './roster.js';
import { makeCentre, makePatient, staffIn, makeSession } from '../../test/factories.js';

beforeEach(seedRoles);

async function setup() {
  const { centre, chairs, shifts } = await makeCentre();
  const base = `/api/centres/${centre.id}`;
  const desk = await staffIn(centre.id, ['front_desk']);
  const rana = await staffIn(centre.id, ['nurse']);
  const ali = await staffIn(centre.id, ['nurse']);
  const post = (o: object) =>
    desk.agent.post(`${base}/roster`).send({ shiftIds: [shifts[0]!.id], chairIds: [], ...o });
  return { centre, chairs, shifts, base, desk, rana, ali, post };
}

describe('roster precedence', () => {
  it('single-day entry beats a month entry for its machines only', async () => {
    const { chairs, shifts, centre, rana, ali, post } = await setup();
    expect((await post({ nurseId: rana.user.id, from: '2026-11-01', to: '2026-11-30' })).status).toBe(201);
    expect((await post({ nurseId: ali.user.id, from: '2026-11-05', to: '2026-11-05', chairIds: [chairs[0]!.id, chairs[1]!.id] })).status).toBe(201);
    const key = (i: number) => `${shifts[0]!.id}:${chairs[i]!.id}`;
    const d5 = await resolveRoster(centre.id, '2026-11-05');
    expect([d5.get(key(0)), d5.get(key(1)), d5.get(key(2))]).toEqual([ali.user.id, ali.user.id, rana.user.id]);
    const d6 = await resolveRoster(centre.id, '2026-11-06');
    expect([0, 1, 2].map((i) => d6.get(key(i)))).toEqual([rana.user.id, rana.user.id, rana.user.id]);
    expect(await nurseFor(centre.id, '2026-12-01', shifts[0]!.id, chairs[0]!.id)).toBeNull();
    // second block has nobody
    expect(d5.get(`${shifts[1]!.id}:${chairs[0]!.id}`)).toBeUndefined();
  });

  it('week entry beats month entry; same span: latest wins', async () => {
    const { chairs, shifts, centre, rana, ali, post } = await setup();
    await post({ nurseId: rana.user.id, from: '2026-11-01', to: '2026-11-30' });
    await post({ nurseId: ali.user.id, from: '2026-11-02', to: '2026-11-08' });
    expect(await nurseFor(centre.id, '2026-11-03', shifts[0]!.id, chairs[0]!.id)).toBe(ali.user.id);
    expect(await nurseFor(centre.id, '2026-11-10', shifts[0]!.id, chairs[0]!.id)).toBe(rana.user.id);
    await post({ nurseId: rana.user.id, from: '2026-11-02', to: '2026-11-08' });
    expect(await nurseFor(centre.id, '2026-11-03', shifts[0]!.id, chairs[0]!.id)).toBe(rana.user.id);
  });

  it('same span: explicit machines beat all-machines', async () => {
    const { chairs, shifts, centre, rana, ali, post } = await setup();
    await post({ nurseId: ali.user.id, from: '2026-11-02', to: '2026-11-08', chairIds: [chairs[0]!.id] });
    await post({ nurseId: rana.user.id, from: '2026-11-02', to: '2026-11-08' }); // later, but empty chairIds
    expect(await nurseFor(centre.id, '2026-11-03', shifts[0]!.id, chairs[0]!.id)).toBe(ali.user.id);
    expect(await nurseFor(centre.id, '2026-11-03', shifts[0]!.id, chairs[1]!.id)).toBe(rana.user.id);
  });

  it('empty chairIds covers active machines only', async () => {
    const { chairs, shifts, centre, rana, post } = await setup();
    chairs[2]!.active = false;
    await chairs[2]!.save();
    await post({ nurseId: rana.user.id, from: '2026-11-02', to: '2026-11-08' });
    const m = await resolveRoster(centre.id, '2026-11-03');
    expect(m.has(`${shifts[0]!.id}:${chairs[2]!.id}`)).toBe(false);
    expect(m.has(`${shifts[0]!.id}:${chairs[0]!.id}`)).toBe(true);
  });
});

describe('roster routes', () => {
  it('creates one entry per block, lists with names, resolves, deletes and audits', async () => {
    const { chairs, shifts, base, desk, rana, post } = await setup();
    const res = await post({ nurseId: rana.user.id, shiftIds: [shifts[0]!.id, shifts[1]!.id], from: '2026-11-02', to: '2026-11-08', chairIds: [chairs[0]!.id] });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    const list = await desk.agent.get(`${base}/roster?from=2026-11-01&to=2026-11-03`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[0]).toMatchObject({ nurse: { id: rana.user.id }, from: '2026-11-02', to: '2026-11-08', chairs: [{ id: chairs[0]!.id, label: '1' }] });
    expect((await desk.agent.get(`${base}/roster?from=2026-11-09&to=2026-11-10`)).body).toEqual([]);
    const resolved = await desk.agent.get(`${base}/roster/resolved?date=2026-11-03`);
    expect(resolved.status).toBe(200);
    expect(resolved.body).toHaveLength(chairs.length * shifts.length);
    const one = resolved.body.find((r: { shiftId: string; chairId: string }) => r.shiftId === shifts[0]!.id && r.chairId === chairs[0]!.id);
    expect(one.nurse).toEqual({ id: rana.user.id, name: rana.user.name });
    expect(resolved.body.filter((r: { nurse: unknown }) => r.nurse === null)).toHaveLength(chairs.length * shifts.length - 2);
    expect((await desk.agent.delete(`${base}/roster/${res.body[0].id}`)).status).toBe(204);
    expect(await RosterEntry.countDocuments()).toBe(1);
    expect(await AuditEntry.countDocuments({ action: 'roster.create' })).toBe(2);
    expect(await AuditEntry.countDocuments({ action: 'roster.delete' })).toBe(1);
  });

  it('validates: non-nurse, order, span, foreign ids, permission', async () => {
    const { base, desk, rana, post, shifts } = await setup();
    const other = await makeCentre();
    const ok = { nurseId: rana.user.id, from: '2026-11-02', to: '2026-11-08' };
    const r = await post({ ...ok, nurseId: desk.user.id });
    expect([r.status, r.body.error]).toEqual([400, 'not_a_nurse']);
    expect((await post({ ...ok, from: '2026-11-09' })).status).toBe(400);
    const long = await post({ ...ok, to: '2027-02-10' });
    expect([long.status, long.body.error]).toEqual([400, 'range_too_long']);
    expect((await post({ ...ok, to: '2027-02-02' })).status).toBe(201); // exactly 92 days
    expect((await post({ ...ok, chairIds: [other.chairs[0]!.id] })).status).toBe(404);
    expect((await post({ ...ok, shiftIds: [other.shifts[0]!.id] })).status).toBe(404);
    expect((await post({ ...ok, shiftIds: [] })).status).toBe(400);
    const denied = await rana.agent.post(`${base}/roster`).send({ ...ok, shiftIds: [shifts[0]!.id], chairIds: [] });
    expect(denied.status).toBe(403);
    // a real entry that belongs to another centre is not reachable from this one
    const otherDesk = await staffIn(other.centre.id, ['front_desk']);
    const otherNurse = await staffIn(other.centre.id, ['nurse']);
    const foreign = await otherDesk.agent
      .post(`/api/centres/${other.centre.id}/roster`)
      .send({ nurseId: otherNurse.user.id, shiftIds: [other.shifts[0]!.id], from: '2026-11-02', to: '2026-11-08', chairIds: [] });
    expect(foreign.status).toBe(201);
    expect((await desk.agent.delete(`${base}/roster/${foreign.body[0].id}`)).status).toBe(404);
    expect(await RosterEntry.countDocuments({ centreId: other.centre.id })).toBe(1);
  });
});

describe('roster snapshot on final status', () => {
  async function missedSetup() {
    const s = await setup();
    await s.post({ nurseId: s.rana.user.id, from: '2026-10-01', to: '2026-10-31' });
    const entry = await s.post({ nurseId: s.ali.user.id, from: '2026-10-05', to: '2026-10-05', chairIds: [s.chairs[0]!.id] });
    const { patient } = await makePatient(s.centre.id);
    const session = await makeSession({
      centreId: s.centre.id, patientId: patient.id, chairId: s.chairs[0]!.id, shiftId: s.shifts[0]!.id,
      date: '2026-10-05', kind: 'regular', status: 'scheduled',
    });
    return { ...s, entry, session, patient };
  }

  it('markMissed stores the roster nurse; deleting the entry later keeps it', async () => {
    const s = await missedSetup();
    await markMissed(new Date('2026-10-18T12:00:00Z'));
    expect(String((await Session.findById(s.session._id))!.rosterNurseId)).toBe(s.ali.user.id);
    await s.desk.agent.delete(`${s.base}/roster/${s.entry.body[0].id}`);
    const board = await s.desk.agent.get(`${s.base}/board?date=2026-10-05&shiftId=${s.shifts[0]!.id}`);
    const card = board.body.other[0];
    expect(card.nurse).toEqual({ id: s.ali.user.id, name: s.ali.user.name });
  });

  it('is not overwritten once set', async () => {
    const s = await missedSetup();
    await Session.updateOne({ _id: s.session._id }, { $set: { rosterNurseId: s.rana.user.id } });
    await markMissed(new Date('2026-10-18T12:00:00Z'));
    expect(String((await Session.findById(s.session._id))!.rosterNurseId)).toBe(s.rana.user.id);
  });

  it('close and postpone store it', async () => {
    const s = await missedSetup();
    const { patient } = await makePatient(s.centre.id);
    const b = await makeSession({
      centreId: s.centre.id, patientId: patient.id, chairId: s.chairs[1]!.id, shiftId: s.shifts[0]!.id,
      date: '2026-10-06', kind: 'regular', status: 'active',
    });
    await closeSession(b, s.rana.user.id);
    expect(String((await Session.findById(b._id))!.rosterNurseId)).toBe(s.rana.user.id);
    await postponeSession(s.session);
    expect(String((await Session.findById(s.session._id))!.rosterNurseId)).toBe(s.ali.user.id);
  });
});
