import { describe, it, expect, beforeEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { Role } from '../auth/role.model.js';
import { seedRoles } from '../auth/roles.seed.js';
import { Centre } from '../centres/centre.model.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { Plan } from '../schedule/plan.model.js';
import { RosterEntry } from '../schedule/roster.model.js';
import { Session } from '../sessions/session.model.js';
import { createUser, makeCentre, makePatient } from '../../test/factories.js';
import { migrateV2, migrationMarker } from './migrate-v2.js';

const raw = (name: string) => mongoose.connection.collection(name);
beforeEach(seedRoles);

async function fixture() {
  const { centre, chairs, shifts } = await makeCentre({ chairs: 6 });
  await raw('centres').updateOne({ _id: centre._id }, { $unset: { workingDays: '' } });
  // the stored front_desk role as it was before v2 (and with one local edit that must survive)
  await Role.updateOne({ key: 'front_desk' }, { $set: { permissions: ['patients.view', 'schedule.book', 'catalog.add'] } });
  const a = await makePatient(centre.id);
  const b = await makePatient(centre.id);
  const nurse = await createUser({ username: 'nurse1', memberships: [{ centreId: centre.id, roleKeys: ['nurse'] }] });
  await raw('patterns').insertMany([
    { centreId: centre._id, patientId: a.patient._id, chairId: chairs[0]!._id, shiftId: shifts[0]!._id, weekdays: [0, 2, 5], from: '2026-01-04', to: null },
    { centreId: centre._id, patientId: b.patient._id, chairId: chairs[1]!._id, shiftId: shifts[1]!._id, weekdays: [1], from: '2026-01-04', to: '2026-02-01' },
  ]);
  await raw('slots').insertOne({ centreId: centre._id, chairId: chairs[0]!._id, shiftId: shifts[0]!._id, weekday: 0, patternId: new Types.ObjectId() });
  // chairs 1,2,3 and 5 for the same nurse and block: runs [1,2,3] and [5]
  await raw('chairassignments').insertMany(
    [0, 1, 2, 4].map((i) => ({ centreId: centre._id, shiftId: shifts[0]!._id, chairId: chairs[i]!._id, nurseId: nurse._id })),
  );
  await raw('treatment_sessions').insertOne({
    centreId: centre._id, patientId: a.patient._id, date: '2026-01-04', chairId: chairs[0]!._id, shiftId: shifts[0]!._id,
    status: 'completed', kind: 'regular', openedBy: nurse._id,
  });
  return { centre, chairs, shifts, a, b, nurse };
}

describe('migrateV2', () => {
  it('converts old patterns, assignments, sessions, centres and the front_desk role', async () => {
    const { centre, chairs, shifts, a, b, nurse } = await fixture();
    const res = await migrateV2();
    expect(res).toMatchObject({ plans: 2, roster: 2, sessions: 1, roles: 1, skipped: [] });

    expect((await Centre.findById(centre._id))!.workingDays.slice().sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const pa = (await Plan.findOne({ patientId: a.patient._id }))!;
    expect(pa).toMatchObject({ from: '2026-01-04', to: null, repeat: 'weekly' });
    expect(pa.items.map((i) => i.weekday).sort()).toEqual([0, 2, 5]);
    expect(pa.items.every((i) => String(i.chairId) === String(chairs[0]!._id) && String(i.shiftId) === String(shifts[0]!._id))).toBe(true);
    expect(await Plan.findOne({ patientId: b.patient._id })).toMatchObject({ to: '2026-02-01' });
    expect(await raw('slots').countDocuments()).toBe(0);

    const today = todayLocal();
    const entries = await RosterEntry.find({ nurseId: nurse._id });
    expect(entries.map((e) => e.chairIds.map(String)).sort((x, y) => x.length - y.length)).toEqual([
      [String(chairs[4]!._id)],
      [0, 1, 2].map((i) => String(chairs[i]!._id)),
    ]);
    expect(entries.every((e) => e.from === today && e.to === addDays(today, 92) && String(e.shiftId) === String(shifts[0]!._id))).toBe(true);

    const s = (await raw('treatment_sessions').findOne({}))!;
    expect(s).toMatchObject({ shiftStart: '07:00', shiftEnd: '11:30', chairLabel: '1', detached: false });
    // migrated history names the nurse who opened it
    expect(String(s.runBy)).toBe(String(nurse._id));

    const fd = (await Role.findOne({ key: 'front_desk' }))!;
    for (const p of ['schedule.setup', 'sessions.run', 'sessions.recordUsage', 'sessions.recordVitals', 'sessions.addNotes']) {
      expect(fd.permissions).toContain(p);
    }
    expect(fd.permissions).toContain('schedule.book');
    expect(await raw('migrations').findOne({ _id: 'v2' as never })).toBeTruthy();
  });

  it('adds the weekdays used by plans to a centre that had no workingDays stored', async () => {
    const { centre } = await fixture();
    await migrateV2();
    expect((await raw('centres').findOne({ _id: centre._id }))!.workingDays).toContain(5);
  });

  it('is idempotent: the second run reports zeros and changes nothing', async () => {
    await fixture();
    await migrateV2();
    const snap = async () => ({ plans: await Plan.countDocuments(), roster: await RosterEntry.countDocuments(), sessions: await Session.countDocuments() });
    const before = await snap();
    expect(await migrateV2()).toEqual({ plans: 0, roster: 0, sessions: 0, roles: 0, skipped: [] });
    expect(await snap()).toEqual(before);
  });

  it('skips a conflicting pattern and an orphan assignment, reports them, and still writes the marker', async () => {
    const { centre, chairs, shifts, a } = await fixture();
    // a second open pattern for the same patient, and an assignment for a nurse that does not exist
    await raw('patterns').insertOne({ centreId: centre._id, patientId: a.patient._id, chairId: chairs[2]!._id, shiftId: shifts[1]!._id, weekdays: [3], from: '2026-03-01', to: null });
    await raw('chairassignments').insertOne({ centreId: centre._id, shiftId: shifts[1]!._id, chairId: chairs[3]!._id, nurseId: new Types.ObjectId() });
    await Plan.init();
    const res = await migrateV2();
    expect(res.plans).toBe(2);
    expect(res.roster).toBe(2);
    expect(res.skipped).toHaveLength(2);
    expect(res.skipped.join('\n')).toMatch(/pattern/);
    expect(res.skipped.join('\n')).toMatch(/assignment/);
    expect(await Plan.countDocuments({ patientId: a.patient._id })).toBe(1);
    const marker = await migrationMarker();
    expect(marker!.counts).toEqual({ plans: 2, roster: 2, sessions: 1, roles: 1 });
    expect(marker!.skipped).toEqual(res.skipped);
    expect(marker!.at).toBeInstanceOf(Date);
    await migrateV2();
    expect((await migrationMarker())!.skipped).toEqual(res.skipped);
    expect(await raw('migrations').countDocuments({ _id: 'v2' as never })).toBe(1);
  });

  it('re-running without the marker (interrupted run) duplicates nothing', async () => {
    await fixture();
    await migrateV2();
    const snap = async () => ({ plans: await Plan.countDocuments(), roster: await RosterEntry.countDocuments(), sessions: await Session.countDocuments() });
    const before = await snap();
    await raw('migrations').deleteMany({});
    const again = await migrateV2();
    expect(again).toMatchObject({ plans: 0, roster: 0, sessions: 0, roles: 0 });
    expect(await snap()).toEqual(before);
  });

  it('sets runBy from openedBy where runBy is missing, without touching sessions that have one', async () => {
    const { centre, chairs, shifts, a, nurse } = await fixture();
    const other = await createUser({ username: 'nurse2' });
    const snap = { shiftStart: '07:00', shiftEnd: '11:30', chairLabel: '2', kind: 'regular', detached: false };
    const at = { centreId: centre._id, patientId: a.patient._id, chairId: chairs[1]!._id, shiftId: shifts[0]!._id };
    const [noRunner, hasRunner, notOpened] = Object.values(
      (await raw('treatment_sessions').insertMany([
        { ...at, ...snap, date: '2026-01-06', status: 'completed', openedBy: nurse._id },
        { ...at, ...snap, date: '2026-01-08', status: 'completed', openedBy: nurse._id, runBy: other._id },
        { ...at, ...snap, date: '2026-01-10', status: 'missed' },
      ])).insertedIds,
    ) as Types.ObjectId[];
    await migrateV2();
    const get = async (id: Types.ObjectId) => (await raw('treatment_sessions').findOne({ _id: id }))!;
    expect(String((await get(noRunner)).runBy)).toBe(String(nurse._id));
    expect(String((await get(hasRunner)).runBy)).toBe(String(other._id));
    expect((await get(notOpened)).runBy).toBeUndefined();
  });

  it("adds the weekdays of a centre's future scheduled sessions to its working days", async () => {
    const { centre, chairs, shifts } = await makeCentre({ name: 'Fri' });
    await raw('centres').updateOne({ _id: centre._id }, { $unset: { workingDays: '' } });
    const { patient } = await makePatient(centre.id);
    let friday = addDays(todayLocal(), 1);
    while (weekdayOf(friday) !== 5) friday = addDays(friday, 1);
    await raw('treatment_sessions').insertOne({
      centreId: centre._id, patientId: patient._id, date: friday, chairId: chairs[0]!._id, shiftId: shifts[0]!._id,
      status: 'scheduled', kind: 'regular',
    });
    await migrateV2();
    expect((await raw('centres').findOne({ _id: centre._id }))!.workingDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('builds the hard double-booking index; on conflicting live sessions it lists them and writes no marker', async () => {
    const { centre, chairs, shifts, a, b } = await fixture();
    await Session.init();
    await raw('treatment_sessions').dropIndex('chairId_1_shiftId_1_date_1');
    try {
      const at = { centreId: centre._id, chairId: chairs[3]!._id, shiftId: shifts[1]!._id, date: '2026-01-05', kind: 'regular' };
      await raw('treatment_sessions').insertMany([
        { ...at, patientId: a.patient._id, status: 'completed' },
        { ...at, patientId: b.patient._id, status: 'scheduled' },
      ]);
      const res = await migrateV2();
      const conflict = res.skipped.find((x) => x.includes('2026-01-05'));
      expect(conflict).toBeDefined();
      expect(conflict).toContain(String(chairs[3]!._id));
      expect(conflict).toContain(String(shifts[1]!._id));
      expect(conflict).toContain(String(a.patient._id));
      expect(conflict).toContain(String(b.patient._id));
      expect(await migrationMarker()).toBeNull();

      // resolved by hand, the re-run builds the index and finishes
      await raw('treatment_sessions').updateOne({ patientId: b.patient._id, date: '2026-01-05' }, { $set: { status: 'cancelled' } });
      const again = await migrateV2();
      expect(again.skipped).toEqual([]);
      expect(await migrationMarker()).not.toBeNull();
      const names = (await raw('treatment_sessions').indexes()).map((i) => i.name);
      expect(names).toContain('chairId_1_shiftId_1_date_1');
      for (const coll of ['plans', 'slotlocks', 'patientplanlocks']) {
        expect((await raw(coll).indexes()).length).toBeGreaterThan(1);
      }
    } finally {
      await raw('treatment_sessions').deleteMany({ date: '2026-01-05' });
      await Session.createIndexes();
    }
  });
});
