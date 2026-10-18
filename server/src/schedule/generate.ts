import type { ClientSession } from 'mongoose';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { Centre } from '../centres/centre.model.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Session } from '../sessions/session.model.js';
import { Plan } from './plan.model.js';

/** How many days ahead (including today) scheduled sessions are materialised. */
export const GENERATION_DAYS = 14;

/**
 * Upserts the `scheduled` regular sessions the patient's current plans imply: for each plan still holding
 * (`to` empty or ≥ today), every working day in `[max(today, from), min(today + 13, to)]` and every item on that
 * weekday. New sessions carry `planId` and the block/machine snapshots. A (patient, date, block) that already
 * has a session (any status, detached included) or that a moved session came from is left alone, so it is safe
 * to run repeatedly and concurrently (the unique index is the guard).
 */
export async function regenerateSessions(patientId: string, today: string = todayLocal()): Promise<void> {
  const plans = await Plan.find({ patientId, $or: [{ to: null }, { to: { $gte: today } }] }).lean();
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
        if (!chair || !shift) continue;
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
    // a concurrent run inserted the same session first: that is the idempotent outcome we want
    const errs = (e as { writeErrors?: { err?: { code?: number } }[] }).writeErrors;
    if (!errs || errs.some((w) => w.err?.code !== 11000)) throw e;
  }
}

/**
 * Refreshes future `scheduled` sessions after a setup or roster change (block times, machine label,
 * rostered nurse). No-op placeholder until the session refresh is implemented.
 */
export async function refreshFutureSessions(_centreId: string, _today: string = todayLocal()): Promise<void> {
  // intentionally empty
}

/** Deletes `scheduled` sessions of the patient dated after `lastDate`. */
export async function deleteScheduledSessionsAfter(
  patientId: string,
  lastDate: string,
  session?: ClientSession,
): Promise<void> {
  await Session.deleteMany({ patientId, status: 'scheduled', date: { $gt: lastDate } }, { session });
}
