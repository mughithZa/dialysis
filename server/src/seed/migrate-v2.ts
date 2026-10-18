import mongoose, { type Types } from 'mongoose';
import { Role } from '../auth/role.model.js';
import { User } from '../auth/user.model.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { Plan } from '../schedule/plan.model.js';
import { RosterEntry } from '../schedule/roster.model.js';
import { PatientPlanLock, SlotLock } from '../schedule/slot-lock.model.js';
import { LIVE_STATUSES, Session } from '../sessions/session.model.js';

export interface MigrateV2Result {
  plans: number;
  roster: number;
  sessions: number;
  roles: number;
  skipped: string[];
}

/** Permissions the v2 front_desk default gained; added to the stored role without touching anything else. */
const FRONT_DESK_NEW = ['schedule.setup', 'sessions.run', 'sessions.recordUsage', 'sessions.recordVitals', 'sessions.addNotes'];
const DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4, 6];
const ROSTER_DAYS = 92;

interface OldPattern { _id: Types.ObjectId; centreId: Types.ObjectId; patientId: Types.ObjectId; chairId: Types.ObjectId; shiftId: Types.ObjectId; weekdays?: number[]; from: string; to?: string | null }
interface OldAssignment { _id: Types.ObjectId; centreId: Types.ObjectId; shiftId: Types.ObjectId; chairId: Types.ObjectId; nurseId: Types.ObjectId }

const coll = (name: string) => mongoose.connection.collection(name);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One-time, idempotent conversion of the old pattern/slot/assignment data to the v2 model.
 * Each record is handled on its own; a record that cannot be converted is skipped and described in `skipped`.
 * The marker is written last, so an interrupted run is simply repeated (already converted records are recognised);
 * it is also withheld while old sessions double-book a machine (listed in `skipped`), so the run can be repeated
 * once they are resolved.
 */
export async function migrateV2(): Promise<MigrateV2Result> {
  const result: MigrateV2Result = { plans: 0, roster: 0, sessions: 0, roles: 0, skipped: [] };
  const migrations = coll('migrations');
  if (await migrations.findOne({ _id: 'v2' as never })) return result;

  const patterns = (await coll('patterns').find({}).toArray()) as unknown as OldPattern[];
  const today = todayLocal();

  // centres: Sat–Thu plus every weekday an old pattern or a future scheduled session uses
  for (const centre of await coll('centres').find({}).toArray()) {
    try {
      const used = patterns.filter((p) => String(p.centreId) === String(centre._id)).flatMap((p) => p.weekdays ?? []);
      const booked = (await coll('treatment_sessions').distinct('date', { centreId: centre._id, status: 'scheduled', date: { $gte: today } })) as string[];
      used.push(...booked.map(weekdayOf));
      const days = [...new Set([...((centre.workingDays as number[] | undefined) ?? DEFAULT_WORKING_DAYS), ...used])].sort();
      await coll('centres').updateOne({ _id: centre._id }, { $set: { workingDays: days } });
    } catch (e) {
      result.skipped.push(`centre ${centre._id}: ${msg(e)}`);
    }
  }

  // patterns -> plans, one item per weekday
  await Plan.init();
  for (const p of patterns) {
    try {
      const weekdays = [...new Set(p.weekdays ?? [])].sort();
      if (weekdays.length === 0) {
        result.skipped.push(`pattern ${p._id}: no weekdays`);
        continue;
      }
      const items = weekdays.map((weekday) => ({ weekday, shiftId: p.shiftId, chairId: p.chairId }));
      const to = p.to ?? null;
      // recognise a plan written by an interrupted earlier run
      const done = await Plan.exists({ patientId: p.patientId, from: p.from, to, 'items.chairId': p.chairId, 'items.shiftId': p.shiftId });
      if (done) continue;
      await Plan.create({ centreId: p.centreId, patientId: p.patientId, items, from: p.from, to, repeat: 'weekly' });
      result.plans++;
    } catch (e) {
      result.skipped.push(`pattern ${p._id}: patient ${p.patientId} could not be given a plan (${msg(e)})`);
    }
  }
  try {
    await coll('slots').drop();
  } catch {
    // no such collection: nothing to drop
  }

  // chair assignments -> roster entries per contiguous run of chairs
  const assignments = (await coll('chairassignments').find({}).toArray()) as unknown as OldAssignment[];
  const groups = new Map<string, OldAssignment[]>();
  for (const a of assignments) {
    const key = `${a.centreId}:${a.shiftId}:${a.nurseId}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  for (const [key, list] of groups) {
    try {
      const { centreId, shiftId, nurseId } = list[0]!;
      const [nurse, shift] = await Promise.all([User.exists({ _id: nurseId }), Shift.exists({ _id: shiftId, centreId })]);
      if (!nurse || !shift) {
        result.skipped.push(`assignment ${key}: ${!nurse ? 'nurse' : 'block'} does not exist`);
        continue;
      }
      const chairs = (await Chair.find({ centreId })).sort((x, y) => x.label.localeCompare(y.label, undefined, { numeric: true }));
      const ids = new Set(list.map((a) => String(a.chairId)));
      const runs: Types.ObjectId[][] = [];
      let prev = false;
      for (const c of chairs) {
        if (ids.has(String(c._id))) {
          if (prev) runs[runs.length - 1]!.push(c._id);
          else runs.push([c._id]);
          prev = true;
        } else prev = false;
      }
      if (runs.length === 0) {
        result.skipped.push(`assignment ${key}: none of its machines exist`);
        continue;
      }
      for (const chairIds of runs) {
        const dup = await RosterEntry.exists({ centreId, nurseId, shiftId, chairIds, to: { $gte: today } });
        if (dup) continue;
        await RosterEntry.create({ centreId, nurseId, shiftId, from: today, to: addDays(today, ROSTER_DAYS), chairIds });
        result.roster++;
      }
    } catch (e) {
      result.skipped.push(`assignment ${key}: ${msg(e)}`);
    }
  }

  // sessions: backfill the snapshots
  const sessions = coll('treatment_sessions');
  const missing = { $or: [{ shiftStart: { $exists: false } }, { shiftEnd: { $exists: false } }, { chairLabel: { $exists: false } }] };
  for (const s of await sessions.find(missing).toArray()) {
    try {
      const [shift, chair] = await Promise.all([Shift.findById(s.shiftId), Chair.findById(s.chairId)]);
      if (!shift || !chair) {
        result.skipped.push(`session ${s._id}: its block or machine no longer exists`);
        continue;
      }
      await sessions.updateOne({ _id: s._id }, { $set: { shiftStart: shift.start, shiftEnd: shift.end, chairLabel: chair.label, detached: false } });
      result.sessions++;
    } catch (e) {
      result.skipped.push(`session ${s._id}: ${msg(e)}`);
    }
  }
  await sessions.updateMany({ detached: { $exists: false } }, { $set: { detached: false } });
  // v1 recorded only who opened a session: that nurse ran it
  await sessions.updateMany({ runBy: { $exists: false }, openedBy: { $exists: true, $ne: null } }, [{ $set: { runBy: '$openedBy' } }]);

  // front_desk gains the new defaults (additive, edits are kept)
  try {
    const r = await Role.updateOne({ key: 'front_desk' }, { $addToSet: { permissions: { $each: FRONT_DESK_NEW } } });
    result.roles = r.modifiedCount;
  } catch (e) {
    result.skipped.push(`role front_desk: ${msg(e)}`);
  }

  // the hard guarantees: build every v2 unique index now, so a conflict in old data is found here, not later
  if (!(await buildIndexes(result))) return result; // no marker: resolve the listed records and run again

  const { skipped, ...counts } = result;
  await migrations.insertOne({ _id: 'v2' as never, at: new Date(), counts, skipped });
  return result;
}

/**
 * Builds the v2 indexes (sessions, plans, slot and patient-plan locks). When the one-live-session-per-slot index
 * cannot be built because old sessions double-book a machine, each conflict is described in `skipped` and false is
 * returned: the marker must not be written until the records are resolved.
 */
async function buildIndexes(result: MigrateV2Result): Promise<boolean> {
  let ok = true;
  try {
    await Session.createIndexes();
  } catch (e) {
    ok = false;
    if ((e as { code?: number }).code !== 11000) {
      result.skipped.push(`session indexes: ${msg(e)}`);
    } else {
      const clashes = await coll('treatment_sessions')
        .aggregate<{ _id: { chairId: unknown; shiftId: unknown; date: string }; patients: unknown[] }>([
          { $match: { status: { $in: [...LIVE_STATUSES] } } },
          { $group: { _id: { chairId: '$chairId', shiftId: '$shiftId', date: '$date' }, patients: { $push: '$patientId' }, n: { $sum: 1 } } },
          { $match: { n: { $gt: 1 } } },
          { $sort: { '_id.date': 1 } },
        ])
        .toArray();
      for (const c of clashes) {
        result.skipped.push(
          `sessions double-book machine ${c._id.chairId} block ${c._id.shiftId} on ${c._id.date} (patients ${c.patients.join(', ')}): resolve, then run again`,
        );
      }
      if (!clashes.length) result.skipped.push(`session indexes: ${msg(e)}`);
    }
  }
  const others: [string, () => Promise<unknown>][] = [
    ['plan', () => Plan.createIndexes()],
    ['slot lock', () => SlotLock.createIndexes()],
    ['patient plan lock', () => PatientPlanLock.createIndexes()],
  ];
  for (const [name, build] of others) {
    try {
      await build();
    } catch (e) {
      ok = false;
      result.skipped.push(`${name} indexes: ${msg(e)}`);
    }
  }
  return ok;
}

export interface MigrationMarker { at: Date; counts: Omit<MigrateV2Result, 'skipped'>; skipped: string[] }

/** The stored outcome of a finished migration, or null when it has not run. */
export async function migrationMarker(): Promise<MigrationMarker | null> {
  const m = await coll('migrations').findOne({ _id: 'v2' as never });
  return m ? ({ at: m.at, counts: m.counts, skipped: m.skipped ?? [] } as MigrationMarker) : null;
}
