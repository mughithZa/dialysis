import { DateTime } from 'luxon';
import { Chair } from '../centres/chair.model.js';
import { RosterEntry } from './roster.model.js';

export const spanDays = (from: string, to: string) =>
  DateTime.fromISO(to, { zone: 'utc' }).diff(DateTime.fromISO(from, { zone: 'utc' }), 'days').days;

/**
 * Who covers each active machine in each block on `date`: key `${shiftId}:${chairId}` -> nurseId.
 * Per machine the winner is the entry with the smallest span, then explicit machines over "all", then the latest created.
 */
export async function resolveRoster(centreId: string, date: string): Promise<Map<string, string>> {
  const [entries, chairs] = await Promise.all([
    RosterEntry.find({ centreId, from: { $lte: date }, to: { $gte: date } }),
    Chair.find({ centreId, active: true }, { _id: 1 }),
  ]);
  const active = new Set(chairs.map((c) => String(c._id)));
  const ranked = entries
    .map((e) => ({ e, span: spanDays(e.from, e.to), explicit: e.chairIds.length > 0 }))
    .sort(
      (a, b) =>
        a.span - b.span ||
        Number(b.explicit) - Number(a.explicit) ||
        b.e.createdAt.getTime() - a.e.createdAt.getTime() ||
        String(b.e._id).localeCompare(String(a.e._id)),
    );
  const out = new Map<string, string>();
  for (const { e, explicit } of ranked) {
    const machines = explicit ? e.chairIds.map(String).filter((c) => active.has(c)) : [...active];
    for (const chairId of machines) {
      const key = `${e.shiftId}:${chairId}`;
      if (!out.has(key)) out.set(key, String(e.nurseId));
    }
  }
  return out;
}

export async function nurseFor(centreId: string, date: string, shiftId: string, chairId: string): Promise<string | null> {
  return (await resolveRoster(centreId, date)).get(`${shiftId}:${chairId}`) ?? null;
}
