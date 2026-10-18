import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { AuditEntry } from '../audit/audit.model.js';
import { Session } from '../sessions/session.model.js';
import { ChairAssignment } from './assignment.model.js';
import { makeCentre, makePatient, staffIn, makeSession } from '../../test/factories.js';

beforeEach(seedRoles);

async function setup() {
  const { centre, chairs, shifts } = await makeCentre();
  const base = `/api/centres/${centre.id}`;
  const desk = await staffIn(centre.id, ['front_desk']);
  const x = await staffIn(centre.id, ['nurse']);
  const y = await staffIn(centre.id, ['nurse']);
  return { centre, chairs, shifts, base, desk, x, y };
}

describe('nurse chair assignments', () => {
  it('sets, lists and audits; replaces previous occupants', async () => {
    const { chairs, shifts, base, desk, x, y } = await setup();
    const put = (nurseId: string, chairIds: string[], shiftId = shifts[0]!.id) =>
      desk.agent.put(`${base}/assignments`).send({ shiftId, nurseId, chairIds });
    expect((await put(x.user.id, [chairs[0]!.id, chairs[1]!.id])).status).toBe(200);
    expect((await put(y.user.id, [chairs[1]!.id])).status).toBe(200);
    const list = await desk.agent.get(`${base}/assignments`);
    expect(list.status).toBe(200);
    const pairs = list.body.map((a: { chairId: string; nurseId: string }) => `${a.chairId}:${a.nurseId}`).sort();
    expect(pairs).toEqual([`${chairs[0]!.id}:${x.user.id}`, `${chairs[1]!.id}:${y.user.id}`].sort());
    expect(await AuditEntry.countDocuments({ action: 'assignment.update' })).toBe(2);
  });

  it('rejects non-nurses, foreign chairs/shifts and missing permission', async () => {
    const { chairs, shifts, base, desk, x } = await setup();
    const other = await makeCentre();
    const put = (o: object) =>
      desk.agent.put(`${base}/assignments`).send({ shiftId: shifts[0]!.id, nurseId: x.user.id, chairIds: [chairs[0]!.id], ...o });
    const res = await put({ nurseId: desk.user.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('not_a_nurse');
    expect((await put({ nurseId: 'nope' })).body.error).toBe('not_a_nurse');
    expect((await put({ chairIds: [other.chairs[0]!.id] })).status).toBe(404);
    expect((await put({ shiftId: other.shifts[0]!.id })).status).toBe(404);
    const denied = await x.agent.put(`${base}/assignments`).send({ shiftId: shifts[0]!.id, nurseId: x.user.id, chairIds: [] });
    expect(denied.status).toBe(403);
    expect(await ChairAssignment.countDocuments()).toBe(0);
  });
});

describe('today view', () => {
  it('splits sessions into mine / unassigned / others', async () => {
    const { centre, chairs, shifts, base, desk, x, y } = await setup();
    const date = '2026-10-19';
    const mk = async (chair: number, shift: number) => {
      const { patient } = await makePatient(centre.id);
      return makeSession({
        centreId: centre.id, patientId: patient.id, chairId: chairs[chair]!.id, shiftId: shifts[shift]!.id,
        date, kind: 'regular', status: 'scheduled',
      });
    };
    const m1 = await mk(0, 0);
    const m2 = await mk(1, 0);
    const a1 = await mk(0, 1);
    const free = await mk(2, 0);
    for (const [nurse, shift] of [[x, 0], [y, 1]] as const) {
      await desk.agent.put(`${base}/assignments`).send({
        shiftId: shifts[shift]!.id, nurseId: nurse.user.id, chairIds: [chairs[0]!.id, chairs[1]!.id],
      });
    }
    const res = await x.agent.get(`${base}/today?date=${date}`);
    expect(res.status).toBe(200);
    const ids = (k: string) => res.body[k].map((c: { id: string }) => c.id).sort();
    expect(ids('mine')).toEqual([m1.id, m2.id].sort());
    expect(ids('unassigned')).toEqual([free.id]);
    expect(ids('others')).toEqual([a1.id]);
    const card = res.body.mine.find((c: { id: string }) => c.id === m1.id);
    expect(card).toMatchObject({
      date, status: 'scheduled', kind: 'regular', hasActiveOrders: false,
      chair: { id: chairs[0]!.id, label: '1' },
      shift: { id: shifts[0]!.id, name: 'Morning', start: '07:00', end: '11:30' },
    });
    expect(card.patient.id).toBeTruthy();
    // a caller with no assignments gets an empty mine
    const none = await desk.agent.get(`${base}/today?date=${date}`);
    expect(none.body.mine).toEqual([]);
    expect(none.body.others).toHaveLength(3);
    expect(none.body.unassigned).toHaveLength(1);
  });

  it('validates date, defaults to today, and ignores other centres', async () => {
    const { base, x } = await setup();
    expect((await x.agent.get(`${base}/today?date=19-10-2026`)).status).toBe(400);
    expect((await x.agent.get(`${base}/today`)).status).toBe(200);
    const other = await makeCentre();
    const { patient } = await makePatient(other.centre.id);
    await makeSession({
      centreId: other.centre.id, patientId: patient.id, chairId: other.chairs[0]!.id, shiftId: other.shifts[0]!.id,
      date: '2026-10-19', kind: 'regular', status: 'scheduled',
    });
    const res = await x.agent.get(`${base}/today?date=2026-10-19`);
    expect(res.body).toEqual({ mine: [], unassigned: [], others: [] });
  });
});
