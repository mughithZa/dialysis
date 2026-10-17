import { Router, type Request } from 'express';
import { DateTime } from 'luxon';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requirePerm } from '../auth/middleware.js';
import { User } from '../auth/user.model.js';
import { recordAudit } from '../audit/record.js';
import { Item } from '../catalog/item.model.js';
import { markItemUsed } from '../catalog/merge.js';
import { Unit } from '../catalog/unit.model.js';
import { withTransaction } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { toSessionCards } from './card.js';
import { Session, type SessionDoc } from './session.model.js';
import {
  assertRecordable,
  closeSession,
  createMakeup,
  loadSessionInCentre,
  openSession,
  postponeSession,
} from './service.js';
import { UsageLine } from './usage.model.js';

export const sessionsRouter = Router({ mergeParams: true });

const centreOf = (req: Request) => String(req.params.centreId);
const sidOf = (req: Request) => String(req.params.sid);
const validId = (id: unknown): id is string => typeof id === 'string' && mongoose.isValidObjectId(id);

async function cardOf(session: SessionDoc) {
  const [row] = await toSessionCards(String(session.centreId), [session]);
  if (!row) throw notFound();
  return row.card;
}

async function detailOf(session: SessionDoc) {
  const card = await cardOf(session);
  const lines = await UsageLine.find({ sessionId: session._id }).sort({ createdAt: 1 });
  const items = await Item.find({ _id: { $in: lines.map((l) => l.itemId) } });
  const units = await Unit.find({ _id: { $in: items.map((i) => i.unitId) } });
  const users = await User.find({ _id: { $in: [...lines.map((l) => l.by), ...session.notes.map((n) => n.by)] } });
  const userDto = (id: unknown) => {
    const u = users.find((x) => String(x._id) === String(id));
    return { id: String(id), name: u?.name ?? '' };
  };
  return {
    ...card,
    vitals: {
      weightBefore: session.vitals?.weightBefore ?? null,
      weightAfter: session.vitals?.weightAfter ?? null,
      bp: (session.vitals?.bp ?? []).map((b) => ({ at: b.at, systolic: b.systolic, diastolic: b.diastolic })),
    },
    notes: session.notes.map((n) => ({ at: n.at, by: userDto(n.by), text: n.text })),
    usage: lines.map((l) => {
      const item = items.find((i) => String(i._id) === String(l.itemId));
      const unit = units.find((u) => String(u._id) === String(item?.unitId));
      return {
        id: l.id as string,
        item: { id: String(l.itemId), name: item?.name ?? '', type: item?.type ?? 'supply', unit: unit?.name ?? '' },
        amount: l.amount,
        by: userDto(l.by),
        at: l.get('createdAt') as Date,
      };
    }),
    orders: [] as object[], // wired up with orders in a later task
  };
}

sessionsRouter.get('/sessions/:sid', requirePerm('sessions.view'), async (req, res, next) => {
  try {
    res.json(await detailOf(await loadSessionInCentre(centreOf(req), sidOf(req))));
  } catch (e) {
    next(e);
  }
});

sessionsRouter.post('/sessions/:sid/open', requirePerm('sessions.run'), async (req, res, next) => {
  try {
    const session = await loadSessionInCentre(centreOf(req), sidOf(req));
    const opened = await openSession(session, String(req.user!._id));
    await recordAudit(req, 'session.open', 'session', opened.id);
    res.json(await cardOf(opened));
  } catch (e) {
    next(e);
  }
});

sessionsRouter.post('/sessions/:sid/close', requirePerm('sessions.run'), async (req, res, next) => {
  try {
    const session = await loadSessionInCentre(centreOf(req), sidOf(req));
    const closed = await closeSession(session, String(req.user!._id));
    await recordAudit(req, 'session.close', 'session', closed.id);
    res.json(await cardOf(closed));
  } catch (e) {
    next(e);
  }
});

sessionsRouter.post('/sessions/:sid/postpone', requirePerm('sessions.postpone'), async (req, res, next) => {
  try {
    const session = await loadSessionInCentre(centreOf(req), sidOf(req));
    const postponed = await postponeSession(session);
    await recordAudit(req, 'session.postpone', 'session', postponed.id);
    res.json(await cardOf(postponed));
  } catch (e) {
    next(e);
  }
});

const usageBody = z.object({ itemId: z.string().min(1), amount: z.number().positive().finite() });

sessionsRouter.post(
  '/sessions/:sid/usage',
  requirePerm('sessions.recordUsage'),
  validate(usageBody),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof usageBody>;
      const session = await loadSessionInCentre(centreOf(req), sidOf(req));
      assertRecordable(session);
      const item = validId(b.itemId) ? await Item.findById(b.itemId) : null;
      if (!item) throw notFound();
      if (item.status === 'retired') throw conflict('item_retired');
      const line = await withTransaction(async (tx) => {
        const [created] = await UsageLine.create(
          [
            {
              sessionId: session._id,
              centreId: session.centreId,
              patientId: session.patientId,
              date: session.date,
              itemId: item._id,
              amount: b.amount,
              by: req.user!._id,
            },
          ],
          { session: tx },
        );
        await markItemUsed(item.id, tx);
        await recordAudit(req, 'usage.add', 'session', session.id, { itemId: item.id, amount: b.amount, lineId: created!.id }, tx);
        return created!;
      });
      res.status(201).json({ id: line.id as string, itemId: item.id as string, amount: line.amount });
    } catch (e) {
      next(e);
    }
  },
);

sessionsRouter.delete('/sessions/:sid/usage/:lineId', requirePerm('sessions.recordUsage'), async (req, res, next) => {
  try {
    const session = await loadSessionInCentre(centreOf(req), sidOf(req));
    assertRecordable(session);
    const lineId = String(req.params.lineId);
    const line = validId(lineId) ? await UsageLine.findById(lineId) : null;
    if (!line || String(line.sessionId) !== session.id) throw notFound();
    await withTransaction(async (tx) => {
      await line.deleteOne({ session: tx });
      await recordAudit(req, 'usage.remove', 'session', session.id, { itemId: String(line.itemId), amount: line.amount, lineId }, tx);
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

const vitalsBody = z
  .object({ weightBefore: z.number().positive().finite().optional(), weightAfter: z.number().positive().finite().optional() })
  .refine((v) => v.weightBefore !== undefined || v.weightAfter !== undefined);
const bpBody = z.object({ systolic: z.number().positive().finite(), diastolic: z.number().positive().finite() });

sessionsRouter.patch(
  '/sessions/:sid/vitals',
  requirePerm('sessions.recordVitals'),
  validate(vitalsBody),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof vitalsBody>;
      const session = await loadSessionInCentre(centreOf(req), sidOf(req));
      assertRecordable(session);
      const set: Record<string, number> = {};
      if (b.weightBefore !== undefined) set['vitals.weightBefore'] = b.weightBefore;
      if (b.weightAfter !== undefined) set['vitals.weightAfter'] = b.weightAfter;
      const r = await Session.updateOne({ _id: session._id, status: session.status }, { $set: set });
      if (!r.matchedCount) throw conflict('bad_status');
      await recordAudit(req, 'vitals.update', 'session', session.id, b);
      res.json((await detailOf((await Session.findById(session._id))!)).vitals);
    } catch (e) {
      next(e);
    }
  },
);

sessionsRouter.post(
  '/sessions/:sid/vitals/bp',
  requirePerm('sessions.recordVitals'),
  validate(bpBody),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof bpBody>;
      const session = await loadSessionInCentre(centreOf(req), sidOf(req));
      assertRecordable(session);
      const reading = { at: new Date(), systolic: b.systolic, diastolic: b.diastolic };
      const r = await Session.updateOne({ _id: session._id, status: session.status }, { $push: { 'vitals.bp': reading } });
      if (!r.matchedCount) throw conflict('bad_status');
      await recordAudit(req, 'vitals.update', 'session', session.id, { bp: b });
      res.status(201).json(reading);
    } catch (e) {
      next(e);
    }
  },
);

const noteBody = z.object({ text: z.string().trim().min(1).max(2000) });

sessionsRouter.post('/sessions/:sid/notes', requirePerm('sessions.addNotes'), validate(noteBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof noteBody>;
    const session = await loadSessionInCentre(centreOf(req), sidOf(req));
    assertRecordable(session);
    const note = { at: new Date(), by: req.user!._id, text: b.text };
    const r = await Session.updateOne({ _id: session._id, status: session.status }, { $push: { notes: note } });
    if (!r.matchedCount) throw conflict('bad_status');
    await recordAudit(req, 'note.add', 'session', session.id);
    res.status(201).json({ at: note.at, by: { id: String(req.user!._id), name: req.user!.name }, text: note.text });
  } catch (e) {
    next(e);
  }
});

const makeupBody = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => DateTime.fromISO(s, { zone: 'utc' }).isValid),
  chairId: z.string().min(1),
  shiftId: z.string().min(1),
});

sessionsRouter.post(
  '/patients/:id/makeup',
  requirePerm('schedule.makeup'),
  validate(makeupBody),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof makeupBody>;
      const session = await createMakeup(centreOf(req), String(req.params.id), b);
      await recordAudit(req, 'session.makeup', 'session', session.id, b);
      res.status(201).json(await cardOf(session));
    } catch (e) {
      next(e);
    }
  },
);
