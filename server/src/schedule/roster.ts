import { DateTime } from 'luxon';
import { User } from '../auth/user.model.js';
import { Chair } from '../centres/chair.model.js';
import { RosterEntry } from './roster.model.js';

export const spanDays = (from: string, to: string) =>
  DateTime.fromISO(to, { zone: 'utc' }).diff(DateTime.fromISO(from, { zone: 'utc' }), 'days').days;

/** Of `nurseIds`, those who can still cover a slot in `centreId`: an active user who is still a member there. */
export async function onDutyNurses(centreId: string, nurseIds: unknown[]): Promise<Set<string>> {
  if (!nurseIds.length) return new Set();
  const users = await User.find({ _id: { $in: nurseIds }, active: true, 'memberships.centreId': centreId }, { _id: 1 });
  return new Set(users.map((u) => String(u._id)));
}

/**
 * Who covers each active machine in each block on `date`: key `${shiftId}:${chairId}` -> nurseId.
 * Per machine the winner is the entry with the smallest span, then explicit machines over "all", then the latest created.
 * Entries of a nurse who was deactivated or left the centre are ignored, so their slots show "No nurse".
 */
export async function resolveRoster(centreId: string, date: string): Promise<Map<string, string>> {
  const [all, chairs] = await Promise.all([
    RosterEntry.find({ centreId, from: { $lte: date }, to: { $gte: date } }),
    Chair.find({ centreId, active: true }, { _id: 1 }),
  ]);
  const onDuty = await onDutyNurses(centreId, [...new Set(all.map((e) => String(e.nurseId)))]);
  const entries = all.filter((e) => onDuty.has(String(e.nurseId)));
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
