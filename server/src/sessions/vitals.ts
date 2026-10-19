import { Centre } from '../centres/centre.model.js';
import { todayLocal } from '../lib/dates.js';
import { Session } from './session.model.js';

export interface VitalsPoint {
  sessionId: string;
  date: string;
  centreName: string;
  weightBefore: number | null;
  weightAfter: number | null;
  /** weightBefore − weightAfter (UF), one decimal; null unless both weights are recorded. */
  weightLoss: number | null;
  /** Average of the session's BP readings, rounded; null without readings. */
  systolic: number | null;
  diastolic: number | null;
  bpCount: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The patient's last `limit` sessions (up to today, any centre, so a transferred patient keeps their history)
 * that have any vitals recorded, oldest first.
 */
export async function buildVitals(patientId: unknown, limit: number): Promise<VitalsPoint[]> {
  const docs = await Session.find({
    patientId,
    date: { $lte: todayLocal() },
    $or: [
      { 'vitals.weightBefore': { $ne: null } },
      { 'vitals.weightAfter': { $ne: null } },
      { 'vitals.bp.0': { $exists: true } },
    ],
  })
    .sort({ date: -1, shiftStart: -1, _id: -1 })
    .limit(limit);
  const centres = await Centre.find({ _id: { $in: docs.map((s) => s.centreId) } }, { name: 1 });
  return docs.reverse().map((s) => {
    const before = s.vitals?.weightBefore ?? null;
    const after = s.vitals?.weightAfter ?? null;
    const bp = s.vitals?.bp ?? [];
    const avg = (pick: (b: (typeof bp)[number]) => number) =>
      bp.length ? Math.round(bp.reduce((sum, b) => sum + pick(b), 0) / bp.length) : null;
    return {
      sessionId: s.id as string,
      date: s.date,
      centreName: centres.find((c) => String(c._id) === String(s.centreId))?.name ?? '',
      weightBefore: before,
      weightAfter: after,
      weightLoss: before != null && after != null ? round1(before - after) : null,
      systolic: avg((b) => b.systolic),
      diastolic: avg((b) => b.diastolic),
      bpCount: bp.length,
    };
  });
}
