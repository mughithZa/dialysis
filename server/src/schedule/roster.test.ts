import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { AuditEntry } from '../audit/audit.model.js';
import { Session } from '../sessions/session.model.js';
import { markMissed } from '../notify/jobs.js';
import { closeSession, postponeSession } from '../sessions/service.js';
import { RosterEntry } from './roster.model.js';
import { resolveRoster, nurseFor } from './roster.js';
import { makeCentre, makePatient, staffIn, makeSession } from '../../test/factories.js';
import { toSessionCards } from '../sessions/card.js';
import { addDays, todayLocal } from '../lib/dates.js';

/** Days from today: the roster API refuses entries starting in the past. */
const d = (n: number) => addDays(todayLocal(), n);

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
    await post({ nurseId: ali.user.id, from: d(15), to: d(21), chairIds: [chairs[0]!.id] });
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
    const res = await post({ nurseId: rana.user.id, shiftIds: [shifts[0]!.id, shifts[1]!.id], from: d(15), to: d(21), chairIds: [chairs[0]!.id] });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    const list = await desk.agent.get(`${base}/roster?from=${d(14)}&to=${d(16)}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[0]).toMatchObject({ nurse: { id: rana.user.id }, from: d(15), to: d(21), chairs: [{ id: chairs[0]!.id, label: '1' }] });
    expect((await desk.agent.get(`${base}/roster?from=${d(22)}&to=${d(23)}`)).body).toEqual([]);
    const resolved = await desk.agent.get(`${base}/roster/resolved?date=${d(16)}`);
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
    const ok = { nurseId: rana.user.id, from: d(15), to: d(21) };
    const r = await post({ ...ok, nurseId: desk.user.id });
    expect([r.status, r.body.error]).toEqual([400, 'not_a_nurse']);
    expect((await post({ ...ok, from: d(22) })).status).toBe(400);
    const past = await post({ ...ok, from: d(-1) });
    expect([past.status, past.body.error]).toEqual([400, 'from_in_past']);
    expect((await post({ ...ok, from: d(0), to: d(0) })).status).toBe(201);
    const long = await post({ ...ok, to: d(15 + 93) });
    expect([long.status, long.body.error]).toEqual([400, 'range_too_long']);
    expect((await post({ ...ok, to: d(15 + 92) })).status).toBe(201); // exactly 92 days
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
      .send({ nurseId: otherNurse.user.id, shiftIds: [other.shifts[0]!.id], from: d(15), to: d(21), chairIds: [] });
    expect(foreign.status).toBe(201);
    expect((await desk.agent.delete(`${base}/roster/${foreign.body[0].id}`)).status).toBe(404);
    expect(await RosterEntry.countDocuments({ centreId: other.centre.id })).toBe(1);
  });
});

describe('roster snapshot on final status', () => {
  async function missedSetup() {
    const s = await setup();
    // past entries are seeded directly: the API refuses a start before today
    const seed = (o: { nurseId: string; from: string; to: string; chairIds?: string[] }) =>
      RosterEntry.create({ centreId: s.centre._id, shiftId: s.shifts[0]!._id, chairIds: [], ...o });
    await seed({ nurseId: s.rana.user.id, from: '2026-10-01', to: '2026-10-31' });
    const created = await seed({ nurseId: s.ali.user.id, from: '2026-10-05', to: '2026-10-05', chairIds: [s.chairs[0]!.id] });
    const entry = { body: [{ id: created.id as string }] };
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

describe('cards: roster fallback', () => {
  it('a past final session without a frozen nurse never takes the current roster; scheduled and active do', async () => {
    const s = await setup();
    const { patient } = await makePatient(s.centre.id);
    const { patient: other } = await makePatient(s.centre.id);
    const at = { centreId: s.centre.id, chairId: s.chairs[0]!.id, shiftId: s.shifts[0]!.id };
    const past = await makeSession({ ...at, patientId: patient.id, date: d(-3), status: 'completed' });
    const missed = await makeSession({ ...at, patientId: other.id, date: d(-4), status: 'missed' });
    const upcoming = await makeSession({ ...at, patientId: patient.id, date: d(2), status: 'scheduled' });
    const active = await makeSession({ ...at, patientId: other.id, date: d(0), status: 'active' });
    // a roster written later that happens to cover those past dates
    await RosterEntry.create({ centreId: s.centre._id, shiftId: s.shifts[0]!._id, chairIds: [], nurseId: s.rana.user._id, from: d(-10), to: d(10) });
    const cards = new Map((await toSessionCards(s.centre.id, [past, missed, upcoming, active])).map(({ card }) => [card.id, card]));
    expect(cards.get(past.id)!.nurse).toBeNull();
    expect(cards.get(missed.id)!.nurse).toBeNull();
    expect(cards.get(upcoming.id)!.nurse).toEqual({ id: s.rana.user.id, name: s.rana.user.name });
    expect(cards.get(active.id)!.nurse).toEqual({ id: s.rana.user.id, name: s.rana.user.name });
  });
});
