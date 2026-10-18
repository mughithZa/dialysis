import { Router, type Request } from 'express';
import { DateTime } from 'luxon';
import mongoose from 'mongoose';
import { z } from 'zod';
import { validate } from '../lib/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { todayLocal } from '../lib/dates.js';
import { withTransaction } from '../db.js';
import { recordAudit } from '../audit/record.js';
import { requirePerm } from '../auth/middleware.js';
import { Role } from '../auth/role.model.js';
import { User } from '../auth/user.model.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { RosterEntry, type RosterEntryDoc } from './roster.model.js';
import { resolveRoster, spanDays } from './roster.js';

export const rosterRouter = Router({ mergeParams: true });

export const MAX_ROSTER_SPAN_DAYS = 92;

const centreOf = (req: Request) => String(req.params.centreId);
const validId = (id: unknown): id is string => typeof id === 'string' && mongoose.isValidObjectId(id);
const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => DateTime.fromISO(s, { zone: 'utc' }).isValid);

const rangeQuery = z.object({ from: localDate, to: localDate });
const dateQuery = z.object({ date: localDate });
const createBody = z.object({
  nurseId: z.string().min(1),
  shiftIds: z.array(z.string().min(1)).min(1),
  from: localDate,
  to: localDate,
  chairIds: z.array(z.string().min(1)),
});

async function entryDtos(entries: RosterEntryDoc[]) {
  const [nurses, chairs] = await Promise.all([
    User.find({ _id: { $in: entries.map((e) => e.nurseId) } }),
    Chair.find({ _id: { $in: entries.flatMap((e) => e.chairIds) } }),
  ]);
  const nurseName = new Map(nurses.map((u) => [u.id as string, u.name]));
  const label = new Map(chairs.map((c) => [c.id as string, c.label]));
  return entries.map((e) => ({
    id: e.id as string,
    nurse: { id: String(e.nurseId), name: nurseName.get(String(e.nurseId)) ?? '' },
    shiftId: String(e.shiftId),
    from: e.from,
    to: e.to,
    chairs: e.chairIds.map((c) => ({ id: String(c), label: label.get(String(c)) ?? '' })),
  }));
}

rosterRouter.get('/', requirePerm('schedule.view'), async (req, res, next) => {
  try {
    const q = rangeQuery.safeParse(req.query);
    if (!q.success) throw badRequest('validation');
    const entries = await RosterEntry.find({ centreId: centreOf(req), from: { $lte: q.data.to }, to: { $gte: q.data.from } }).sort({ from: 1, _id: 1 });
    res.json(await entryDtos(entries));
  } catch (e) {
    next(e);
  }
});

rosterRouter.get('/resolved', requirePerm('schedule.view'), async (req, res, next) => {
  try {
    const q = dateQuery.safeParse(req.query);
    if (!q.success) throw badRequest('validation');
    const centreId = centreOf(req);
    const [map, chairs, shifts] = await Promise.all([
      resolveRoster(centreId, q.data.date),
      Chair.find({ centreId, active: true }).sort({ label: 1 }),
      Shift.find({ centreId, active: true }).sort({ start: 1 }),
    ]);
    const nurses = new Map((await User.find({ _id: { $in: [...new Set(map.values())] } })).map((u) => [u.id as string, u.name]));
    res.json(
      shifts.flatMap((s) =>
        chairs.map((c) => {
          const id = map.get(`${s.id}:${c.id}`);
          return { shiftId: s.id as string, chairId: c.id as string, nurse: id ? { id, name: nurses.get(id) ?? '' } : null };
        }),
      ),
    );
  } catch (e) {
    next(e);
  }
});

rosterRouter.post('/', requirePerm('schedule.assignNurses'), validate(createBody), async (req, res, next) => {
  try {
    const centreId = centreOf(req);
    const b = req.body as z.infer<typeof createBody>;
    if (b.from > b.to) throw badRequest('validation');
    // the past is frozen: a new entry must not re-staff sessions that already happened
    if (b.from < todayLocal()) throw badRequest('from_in_past');
    if (spanDays(b.from, b.to) > MAX_ROSTER_SPAN_DAYS) throw badRequest('range_too_long');
    const shiftIds = [...new Set(b.shiftIds)];
    const chairIds = [...new Set(b.chairIds)];
    const shifts = shiftIds.every(validId) ? await Shift.find({ _id: { $in: shiftIds }, centreId }) : [];
    if (shifts.length !== shiftIds.length) throw notFound();
    const chairs = chairIds.every(validId) ? await Chair.find({ _id: { $in: chairIds }, centreId }) : [];
    if (chairs.length !== chairIds.length) throw notFound();
    const nurseRole = await Role.findOne({ key: 'nurse' });
    const nurse = validId(b.nurseId) ? await User.findById(b.nurseId) : null;
    const isNurse =
      !!nurseRole &&
      !!nurse &&
      nurse.active &&
      nurse.memberships.some((m) => String(m.centreId) === centreId && m.roleIds.some((r) => String(r) === String(nurseRole._id)));
    if (!isNurse) throw badRequest('not_a_nurse');
    const created = await withTransaction(async (tx) => {
      const docs = await RosterEntry.create(
        shiftIds.map((shiftId) => ({ centreId, nurseId: b.nurseId, shiftId, from: b.from, to: b.to, chairIds })),
        { session: tx, ordered: true },
      );
      for (const d of docs) await recordAudit(req, 'roster.create', 'roster', d.id, { ...b, shiftId: String(d.shiftId) }, tx);
      return docs;
    });
    res.status(201).json(await entryDtos(created));
  } catch (e) {
    next(e);
  }
});

rosterRouter.delete('/:id', requirePerm('schedule.assignNurses'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const entry = validId(id) ? await RosterEntry.findById(id) : null;
    if (!entry || String(entry.centreId) !== centreOf(req)) throw notFound();
    await withTransaction(async (tx) => {
      await RosterEntry.deleteOne({ _id: entry._id }, { session: tx });
      await recordAudit(
        req, 'roster.delete', 'roster', entry.id,
        { nurseId: String(entry.nurseId), shiftId: String(entry.shiftId), from: entry.from, to: entry.to },
        tx,
      );
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
