import type { ClientSession } from 'mongoose';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { Centre } from '../centres/centre.model.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Patient } from '../patients/patient.model.js';
import { Session } from '../sessions/session.model.js';
import { Plan } from './plan.model.js';

/** How many days ahead (including today) scheduled sessions are materialised. */
export const GENERATION_DAYS = 14;

/**
 * Upserts the `scheduled` regular sessions the patient's current plans imply: for each plan still holding
 * (`to` empty or ≥ today), every working day in `[max(today, from), min(today + 13, to)]` and every item on that
 * weekday. New sessions carry `planId` and the block/machine snapshots. A (patient, date, block) that already
 * has a session (any status, detached included) or that a moved session came from is left alone, so it is safe
 * to run repeatedly and concurrently (the unique index is the guard). Plans filed under a centre the patient no
 * longer belongs to (left behind by a transfer) generate nothing.
 */
export async function regenerateSessions(patientId: string, today: string = todayLocal()): Promise<void> {
  const patient = await Patient.findById(patientId, { centreId: 1 }).lean();
  const plans = (await Plan.find({ patientId, $or: [{ to: null }, { to: { $gte: today } }] }).lean()).filter(
    (p) => !patient || String(p.centreId) === String(patient.centreId),
  );
  if (!plans.length) return;
  const last = addDays(today, GENERATION_DAYS - 1);
  const items = plans.flatMap((p) => p.items);
  const [centres, chairs, shifts, moved] = await Promise.all([
    Centre.find({ _id: { $in: plans.map((p) => p.centreId) } }).lean(),
    Chair.find({ _id: { $in: items.map((i) => i.chairId) } }).lean(),
    Shift.find({ _id: { $in: items.map((i) => i.shiftId) } }).lean(),
    Session.find({ patientId, 'movedFrom.date': { $gte: today, $lte: last } }, { movedFrom: 1 }).lean(),
  ]);
  const centreOf = new Map(centres.map((c) => [String(c._id), c]));
  const chairOf = new Map(chairs.map((c) => [String(c._id), c]));
  const shiftOf = new Map(shifts.map((s) => [String(s._id), s]));
  const movedAway = new Set(moved.map((s) => `${s.movedFrom!.date}:${String(s.movedFrom!.shiftId)}`));

  const ops = [];
  for (const plan of plans) {
    const centre = centreOf.get(String(plan.centreId));
    if (!centre) continue;
    const first = plan.from > today ? plan.from : today;
    const end = plan.to && plan.to < last ? plan.to : last;
    for (let date = first; date <= end; date = addDays(date, 1)) {
      const weekday = weekdayOf(date);
      if (!centre.workingDays.includes(weekday)) continue;
      for (const item of plan.items) {
        if (item.weekday !== weekday || movedAway.has(`${date}:${String(item.shiftId)}`)) continue;
        const chair = chairOf.get(String(item.chairId));
        const shift = shiftOf.get(String(item.shiftId));
        if (!chair?.active || !shift?.active) continue;
        ops.push({
          updateOne: {
            filter: { patientId: plan.patientId, date, shiftId: item.shiftId },
            update: {
              $setOnInsert: {
                centreId: plan.centreId,
                chairId: item.chairId,
                planId: plan._id,
                shiftStart: shift.start,
                shiftEnd: shift.end,
                chairLabel: chair.label,
                kind: 'regular' as const,
                status: 'scheduled' as const,
              },
            },
            upsert: true,
          },
        });
      }
    }
  }
  if (!ops.length) return;
  try {
    await Session.bulkWrite(ops, { ordered: false });
  } catch (e) {
    const errs = (e as { writeErrors?: { err?: { code?: number; errmsg?: string } }[] }).writeErrors;
    if (!errs || errs.some((w) => w.err?.code !== 11000)) throw e;
    // a duplicate on the patient/date/block key is a concurrent run inserting the same session: the idempotent
    // outcome. A duplicate on the chair key means another patient holds that machine: skipped, reported once.
    const taken = errs.filter((w) => w.err?.errmsg?.includes('chairId_1'));
    if (taken.length) {
      console.warn(`generate: ${taken.length} session(s) for patient ${patientId} skipped, machine already taken`);
    }
  }
}

/**
 * Refreshes future `scheduled` sessions (date >= today) after a setup change: block times and machine labels are
 * re-read from the current setup, and sessions on a non-working day or an inactive block/machine are deleted
 * (a safety net; setup refuses these while in use). Then the centre's patients are regenerated.
 * Past sessions and sessions in any other status are never touched.
 */
export async function refreshFutureSessions(centreId: string, today: string = todayLocal()): Promise<void> {
  const [centre, chairs, shifts, sessions] = await Promise.all([
    Centre.findById(centreId).lean(),
    Chair.find({ centreId }).lean(),
    Shift.find({ centreId }).lean(),
    Session.find({ centreId, status: 'scheduled', date: { $gte: today } }).lean(),
  ]);
  if (!centre) return;
  const chairOf = new Map(chairs.map((c) => [String(c._id), c]));
  const shiftOf = new Map(shifts.map((s) => [String(s._id), s]));
  const drop: unknown[] = [];
  const ops = [];
  for (const s of sessions) {
    const chair = chairOf.get(String(s.chairId));
    const shift = shiftOf.get(String(s.shiftId));
    if (!centre.workingDays.includes(weekdayOf(s.date)) || !chair?.active || !shift?.active) {
      drop.push(s._id);
    } else if (s.shiftStart !== shift.start || s.shiftEnd !== shift.end || s.chairLabel !== chair.label) {
      ops.push({
        updateOne: {
          filter: { _id: s._id, status: 'scheduled' as const },
          update: { $set: { shiftStart: shift.start, shiftEnd: shift.end, chairLabel: chair.label } },
        },
      });
    }
  }
  if (drop.length) await Session.deleteMany({ _id: { $in: drop }, status: 'scheduled' });
  if (ops.length) await Session.bulkWrite(ops);
  const patients = await Plan.distinct('patientId', { centreId, $or: [{ to: null }, { to: { $gte: today } }] });
  for (const patientId of patients) await regenerateSessions(String(patientId), today);
}

/**
 * `refreshFutureSessions` run after a setup write has committed: a failure is logged, never surfaced, because the
 * write itself succeeded and the nightly generation refreshes again.
 */
export async function refreshAfterSave(centreId: string): Promise<void> {
  try {
    await refreshFutureSessions(centreId);
  } catch (e) {
    console.error(`refresh of future sessions for centre ${centreId} failed (the nightly generation retries)`, e);
  }
}

/** Deletes `scheduled` sessions of the patient dated after `lastDate`. */
export async function deleteScheduledSessionsAfter(
  patientId: string,
  lastDate: string,
  session?: ClientSession,
): Promise<void> {
  await Session.deleteMany({ patientId, status: 'scheduled', date: { $gt: lastDate } }, { session });
}
