import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { localDateTime } from '../lib/dates.js';
import { RosterEntry } from './roster.model.js';
import { buildBoard } from './board.js';
import { makeCentre, makePatient, makeSession, staffIn } from '../../test/factories.js';

beforeEach(seedRoles);

const MON = '2026-10-19';
const FRI = '2026-10-16';
const at = (date: string, hhmm: string) => localDateTime(date, hhmm);

async function setup() {
  const { centre, chairs, shifts } = await makeCentre({
    chairs: 12,
    shifts: [
      { name: 'Session 1', start: '07:00', end: '12:00' },
      { name: 'Session 2', start: '12:00', end: '17:00' },
    ],
  });
  const c = centre.id as string;
  const rana = await staffIn(c, ['nurse']);
  const ali = await staffIn(c, ['nurse']);
  const sess = async (chair: number, status: string, o: object = {}, shift = 0) =>
    makeSession({
      centreId: c,
      patientId: (await makePatient(c)).patient.id,
      chairId: chairs[chair]!.id,
      shiftId: shifts[shift]!.id,
      date: MON,
      status,
      ...o,
    });
  return { c, chairs, shifts, rana, ali, sess };
}

describe('buildBoard default block', () => {
  it('11:59 -> Session 1, 12:00 -> Session 2, 17:00 -> Session 2 (last), early -> first', async () => {
    const { c, shifts, rana } = await setup();
    const id = rana.user.id as string;
    const pick = async (hhmm: string) => (await buildBoard(c, id, { now: at(MON, hhmm) })).shiftId;
    expect(await pick('11:59')).toBe(shifts[0]!.id);
    expect(await pick('12:00')).toBe(shifts[1]!.id);
    expect(await pick('17:00')).toBe(shifts[1]!.id);
    expect(await pick('05:00')).toBe(shifts[0]!.id);
  });

  it('another date defaults to the first block; blocks listed in order', async () => {
    const { c, shifts, rana } = await setup();
    const b = await buildBoard(c, rana.user.id as string, { date: '2026-10-20', now: at(MON, '13:00') });
    expect(b.shiftId).toBe(shifts[0]!.id);
    expect(b.blocks.map((x) => x.name)).toEqual(['Session 1', 'Session 2']);
  });

  it('Friday is not a working day', async () => {
    const { c, rana, sess } = await setup();
    await sess(0, 'scheduled', { date: FRI });
    const b = await buildBoard(c, rana.user.id as string, { now: at(FRI, '09:00') });
    expect(b).toMatchObject({ date: FRI, working: false, active: [], waiting: [], done: [], emptyMachines: [] });
  });

  it('unknown shift is 404', async () => {
    const { c, rana } = await setup();
    await expect(
      buildBoard(c, rana.user.id as string, { shiftId: '64b000000000000000000000', now: at(MON, '09:00') }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('buildBoard rows', () => {
  it('groups by status, sorts by machine number, flags mine, lists empty machines', async () => {
    const { c, chairs, shifts, rana, ali, sess } = await setup();
    await RosterEntry.create({
      centreId: c,
      nurseId: rana.user._id,
      shiftId: shifts[0]!._id,
      chairIds: [chairs[0]!._id],
      from: MON,
      to: MON,
    });
    await sess(10, 'scheduled'); // machine 11
    await sess(0, 'scheduled'); // machine 1, rostered to rana
    await sess(1, 'active', { runBy: ali.user._id });
    await sess(2, 'completed', { runBy: rana.user._id });
    await sess(3, 'did_not_come');
    await sess(4, 'postponed');
    await sess(5, 'cancelled');
    await sess(6, 'missed');
    await sess(7, 'scheduled', {}, 1); // other block: ignored
    const b = await buildBoard(c, rana.user.id as string, { date: MON, shiftId: shifts[0]!.id, now: at(MON, '09:00') });
    expect(b.working).toBe(true);
    expect(b.waiting.map((r) => r.chairLabel)).toEqual(['1', '11']);
    expect(b.waiting.map((r) => r.mine)).toEqual([true, false]); // rostered nurse
    expect(b.active.map((r) => [r.chairLabel, r.mine])).toEqual([['2', false]]);
    expect(b.done.map((r) => [r.chairLabel, r.mine])).toEqual([['3', true]]); // ran it
    expect(b.didNotCome.map((r) => r.chairLabel)).toEqual(['4']);
    expect(b.other.map((r) => r.chairLabel)).toEqual(['5', '6', '7']);
    // live machines: 1, 2, 3, 11; the dead-session machines and the rest are empty
    expect(b.emptyMachines.map((m) => m.label)).toEqual(['4', '5', '6', '7', '8', '9', '10', '12']);
  });
});

describe('GET /board', () => {
  it('serves the board, 404 on bad shift, 400 on bad date', async () => {
    const { c, shifts, rana, sess } = await setup();
    await sess(0, 'scheduled');
    const base = `/api/centres/${c}/board`;
    const ok = await rana.agent.get(`${base}?date=${MON}&shiftId=${shifts[0]!.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.waiting).toHaveLength(1);
    expect((await rana.agent.get(`${base}?shiftId=64b000000000000000000000`)).status).toBe(404);
    expect((await rana.agent.get(`${base}?date=nope`)).status).toBe(400);
  });
});
