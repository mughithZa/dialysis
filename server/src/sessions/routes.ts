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
import { Centre } from '../centres/centre.model.js';
import { Shift } from '../centres/shift.model.js';
import { activeOrdersFor } from '../orders/service.js';
import { loadPatientInCentre } from '../patients/load.js';
import { recentNotesFor } from '../notes/service.js';
import { addDays, localDateTime, todayLocal } from '../lib/dates.js';
import { buildTimeline } from './timeline.js';
import { toSessionCards } from './card.js';
import { SessionChange } from './change.model.js';
import { Session, type SessionDoc } from './session.model.js';
import {
  cancelSession,
  closeSession,
  createMakeup,
  didNotCome,
  loadSessionInCentre,
  moveSession,
  openSession,
  postponeSession,
  recordChange,
  withRecordable,
} from './service.js';
import { UsageLine } from './usage.model.js';

export const sessionsRouter = Router({ mergeParams: true });

const centreOf = (req: Request) => String(req.params.centreId);
const sidOf = (req: Request) => String(req.params.sid);
const validId = (id: unknown): id is string => typeof id === 'string' && mongoose.isValidObjectId(id);

async function cardOf(session: SessionDoc) {
  const [row] = await toSessionCards(String(session.centreId), [session], { includeMoved: true });
  if (!row) throw notFound();
  return row.card;
}

/** Card + vitals + notes + usage of one session (no orders). */
async function historyOf(session: SessionDoc) {
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
    notes: session.notes.map((n) => ({ id: String(n._id), at: n.at, by: userDto(n.by), text: n.text })),
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
  };
}

async function detailOf(session: SessionDoc) {
  return {
    ...(await historyOf(session)),
    orders: await activeOrdersFor(session.patientId, session.date),
    recentNotes: await recentNotesFor(session.patientId, localDateTime(addDays(todayLocal(), -30), '00:00')),
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
    const opened = await withTransaction(async (tx) => {
      const o = await openSession(session, String(req.user!._id), tx);
      await recordAudit(req, 'session.open', 'session', o.id, undefined, tx);
      return o;
    });
    res.json(await cardOf(opened));
  } catch (e) {
    next(e);
  }
});

sessionsRouter.post('/sessions/:sid/close', requirePerm('sessions.run'), async (req, res, next) => {
  try {
    const session = await loadSessionInCentre(centreOf(req), sidOf(req));
    const closed = await withTransaction(async (tx) => {
      const c = await closeSession(session, String(req.user!._id), tx);
      await recordAudit(req, 'session.close', 'session', c.id, undefined, tx);
      return c;
    });
    res.json(await cardOf(closed));
  } catch (e) {
    next(e);
  }
});

sessionsRouter.post('/sessions/:sid/postpone', requirePerm('sessions.postpone'), async (req, res, next) => {
  try {
    const session = await loadSessionInCentre(centreOf(req), sidOf(req));
    const postponed = await withTransaction(async (tx) => {
      const p = await postponeSession(session, tx);
      await recordAudit(req, 'session.postpone', 'session', p.id, undefined, tx);
      return p;
    });
    res.json(await cardOf(postponed));
  } catch (e) {
    next(e);
  }
});

const reasonBody = z.object({ reason: z.string().trim().min(1).max(200).optional() }).strict();
const cancelBody = z.object({ reason: z.string().trim().min(1).max(200) });
const moveBody = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => DateTime.fromISO(s, { zone: 'utc' }).isValid),
  shiftId: z.string().min(1),
  chairId: z.string().min(1),
});

sessionsRouter.post(
  '/sessions/:sid/did-not-come',
  requirePerm('sessions.postpone'),
  validate(reasonBody),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof reasonBody>;
      const session = await loadSessionInCentre(centreOf(req), sidOf(req));
      const updated = await withTransaction(async (tx) => {
        const u = await didNotCome(session, b.reason, tx);
        await recordAudit(req, 'session.did_not_come', 'session', u.id, b.reason ? { reason: b.reason } : undefined, tx);
        return u;
      });
      res.json(await cardOf(updated));
    } catch (e) {
      next(e);
    }
  },
);

sessionsRouter.post('/sessions/:sid/cancel', requirePerm('sessions.postpone'), validate(cancelBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof cancelBody>;
    const session = await loadSessionInCentre(centreOf(req), sidOf(req));
    const updated = await withTransaction(async (tx) => {
      const u = await cancelSession(session, b.reason, tx);
      await recordAudit(req, 'session.cancel', 'session', u.id, { reason: b.reason }, tx);
      return u;
    });
    res.json(await cardOf(updated));
  } catch (e) {
    next(e);
  }
});

sessionsRouter.post('/sessions/:sid/move', requirePerm('schedule.book'), validate(moveBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof moveBody>;
    const session = await loadSessionInCentre(centreOf(req), sidOf(req));
    const from = { date: session.date, shiftId: String(session.shiftId), chairId: String(session.chairId) };
    const moved = await withTransaction(async (tx) => {
      const m = await moveSession(centreOf(req), session.id, b, tx);
      await recordAudit(req, 'session.move', 'session', m.id, { from, to: b }, tx);
      return m;
    });
    res.json(await cardOf(moved));
  } catch (e) {
    next(e);
  }
});

const usageBody = z.object({ itemId: z.string().min(1), amount: z.number().positive().finite() });
const amountBody = z.object({ amount: z.number().positive().finite() });
const usageSnapshot = (itemId: unknown, itemName: string, amount: number) => ({ itemId: String(itemId), itemName, amount });

sessionsRouter.post(
  '/sessions/:sid/usage',
  requirePerm('sessions.view'),
  validate(usageBody),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof usageBody>;
      const session = await loadSessionInCentre(centreOf(req), sidOf(req));
      const item = validId(b.itemId) ? await Item.findById(b.itemId) : null;
      if (!item) throw notFound();
      if (item.status === 'retired') throw conflict('item_retired');
      const line = await withRecordable(session.id, req.perms!, 'sessions.recordUsage', async (tx, fresh, closed) => {
        const [created] = await UsageLine.create(
          [
            {
              sessionId: fresh._id,
              centreId: fresh.centreId,
              patientId: fresh.patientId,
              date: fresh.date,
              itemId: item._id,
              amount: b.amount,
              by: req.user!._id,
            },
          ],
          { session: tx },
        );
        await markItemUsed(item.id, tx);
        if (closed) await recordChange(tx, fresh.id, req.user!._id, 'usage.add', null, usageSnapshot(item.id, item.name, b.amount));
        await recordAudit(req, 'usage.add', 'session', fresh.id, { itemId: item.id, amount: b.amount, lineId: created!.id }, tx);
        return created!;
      });
      res.status(201).json({ id: line.id as string, itemId: item.id as string, amount: line.amount });
    } catch (e) {
      next(e);
    }
  },
);

async function loadLine(sessionId: string, lineId: unknown) {
  const line = validId(lineId) ? await UsageLine.findById(lineId) : null;
  if (!line || String(line.sessionId) !== sessionId) throw notFound();
  const item = await Item.findById(line.itemId);
  return { line, itemName: item?.name ?? '' };
}

sessionsRouter.patch(
  '/sessions/:sid/usage/:lineId',
  requirePerm('sessions.view'),
  validate(amountBody),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof amountBody>;
      const session = await loadSessionInCentre(centreOf(req), sidOf(req));
      const { line, itemName } = await loadLine(session.id, req.params.lineId);
      await withRecordable(session.id, req.perms!, 'sessions.recordUsage', async (tx, fresh, closed) => {
        const current = await UsageLine.findById(line._id, null, { session: tx });
        if (!current) throw notFound();
        const before = current.amount;
        await UsageLine.updateOne({ _id: line._id }, { $set: { amount: b.amount } }, { session: tx });
        if (closed) {
          await recordChange(
            tx,
            fresh.id,
            req.user!._id,
            'usage.update',
            usageSnapshot(line.itemId, itemName, before),
            usageSnapshot(line.itemId, itemName, b.amount),
          );
        }
        await recordAudit(req, 'usage.update', 'session', fresh.id, { lineId: line.id, before, after: b.amount }, tx);
      });
      res.json({ id: line.id as string, itemId: String(line.itemId), amount: b.amount });
    } catch (e) {
      next(e);
    }
  },
);

sessionsRouter.delete('/sessions/:sid/usage/:lineId', requirePerm('sessions.view'), async (req, res, next) => {
  try {
    const session = await loadSessionInCentre(centreOf(req), sidOf(req));
    const { line, itemName } = await loadLine(session.id, req.params.lineId);
    await withRecordable(session.id, req.perms!, 'sessions.recordUsage', async (tx, fresh, closed) => {
      const current = await UsageLine.findById(line._id, null, { session: tx });
      if (!current) throw notFound();
      await UsageLine.deleteOne({ _id: line._id }, { session: tx });
      if (closed) await recordChange(tx, fresh.id, req.user!._id, 'usage.remove', usageSnapshot(line.itemId, itemName, current.amount), null);
      await recordAudit(req, 'usage.remove', 'session', fresh.id, { itemId: String(line.itemId), amount: current.amount, lineId: line.id }, tx);
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
  requirePerm('sessions.view'),
  validate(vitalsBody),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof vitalsBody>;
      const session = await loadSessionInCentre(centreOf(req), sidOf(req));
      const updated = await withRecordable(session.id, req.perms!, 'sessions.recordVitals', async (tx, fresh, closed) => {
        const set: Record<string, number> = {};
        const before: Record<string, number | null> = {};
        const after: Record<string, number> = {};
        for (const k of ['weightBefore', 'weightAfter'] as const) {
          if (b[k] === undefined) continue;
          set[`vitals.${k}`] = b[k];
          before[k] = fresh.vitals?.[k] ?? null;
          after[k] = b[k];
        }
        const doc = await Session.findOneAndUpdate({ _id: fresh._id }, { $set: set }, { new: true, session: tx });
        if (closed) await recordChange(tx, fresh.id, req.user!._id, 'vitals.update', before, after);
        await recordAudit(req, 'vitals.update', 'session', fresh.id, b, tx);
        return doc!;
      });
      res.json((await detailOf(updated)).vitals);
    } catch (e) {
      next(e);
    }
  },
);

sessionsRouter.post(
  '/sessions/:sid/vitals/bp',
  requirePerm('sessions.view'),
  validate(bpBody),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof bpBody>;
      const session = await loadSessionInCentre(centreOf(req), sidOf(req));
      const reading = { at: new Date(), systolic: b.systolic, diastolic: b.diastolic };
      await withRecordable(session.id, req.perms!, 'sessions.recordVitals', async (tx, fresh, closed) => {
        await Session.updateOne({ _id: fresh._id }, { $push: { 'vitals.bp': reading } }, { session: tx });
        if (closed) await recordChange(tx, fresh.id, req.user!._id, 'vitals.update', null, { bp: b });
        await recordAudit(req, 'vitals.update', 'session', fresh.id, { bp: b }, tx);
      });
      res.status(201).json(reading);
    } catch (e) {
      next(e);
    }
  },
);

const noteBody = z.object({ text: z.string().trim().min(1).max(2000) });
const noteIdOf = (req: Request) => {
  const id = String(req.params.noteId);
  if (!validId(id)) throw notFound();
  return id;
};

sessionsRouter.post('/sessions/:sid/notes', requirePerm('sessions.view'), validate(noteBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof noteBody>;
    const session = await loadSessionInCentre(centreOf(req), sidOf(req));
    const note = { _id: new mongoose.Types.ObjectId(), at: new Date(), by: req.user!._id, text: b.text };
    await withRecordable(session.id, req.perms!, 'sessions.addNotes', async (tx, fresh, closed) => {
      await Session.updateOne({ _id: fresh._id }, { $push: { notes: note } }, { session: tx });
      if (closed) await recordChange(tx, fresh.id, req.user!._id, 'note.add', null, { text: b.text });
      await recordAudit(req, 'note.add', 'session', fresh.id, undefined, tx);
    });
    res.status(201).json({ id: String(note._id), at: note.at, by: { id: String(req.user!._id), name: req.user!.name }, text: note.text });
  } catch (e) {
    next(e);
  }
});

sessionsRouter.patch(
  '/sessions/:sid/notes/:noteId',
  requirePerm('sessions.view'),
  validate(noteBody),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof noteBody>;
      const session = await loadSessionInCentre(centreOf(req), sidOf(req));
      const noteId = noteIdOf(req);
      await withRecordable(session.id, req.perms!, 'sessions.addNotes', async (tx, fresh, closed) => {
        const note = fresh.notes.find((n) => String(n._id) === noteId);
        if (!note) throw notFound();
        const before = note.text;
        await Session.updateOne({ _id: fresh._id, 'notes._id': noteId }, { $set: { 'notes.$.text': b.text } }, { session: tx });
        if (closed) await recordChange(tx, fresh.id, req.user!._id, 'note.update', { text: before }, { text: b.text });
        await recordAudit(req, 'note.update', 'session', fresh.id, { noteId }, tx);
      });
      res.json({ id: noteId, text: b.text });
    } catch (e) {
      next(e);
    }
  },
);

sessionsRouter.delete('/sessions/:sid/notes/:noteId', requirePerm('sessions.view'), async (req, res, next) => {
  try {
    const session = await loadSessionInCentre(centreOf(req), sidOf(req));
    const noteId = noteIdOf(req);
    await withRecordable(session.id, req.perms!, 'sessions.addNotes', async (tx, fresh, closed) => {
      const note = fresh.notes.find((n) => String(n._id) === noteId);
      if (!note) throw notFound();
      await Session.updateOne({ _id: fresh._id }, { $pull: { notes: { _id: noteId } } }, { session: tx });
      if (closed) await recordChange(tx, fresh.id, req.user!._id, 'note.remove', { text: note.text }, null);
      await recordAudit(req, 'note.remove', 'session', fresh.id, { noteId }, tx);
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

sessionsRouter.get('/sessions/:sid/history', requirePerm('sessions.viewHistory'), async (req, res, next) => {
  try {
    const session = await loadSessionInCentre(centreOf(req), sidOf(req));
    const changes = await SessionChange.find({ sessionId: session._id }).sort({ at: -1, _id: -1 });
    const users = await User.find({ _id: { $in: changes.map((c) => c.by) } });
    res.json(
      changes.map((c) => ({
        id: c.id as string,
        at: c.at,
        kind: c.kind,
        by: { id: String(c.by), name: users.find((u) => String(u._id) === String(c.by))?.name ?? '' },
        before: c.before ?? null,
        after: c.after ?? null,
      })),
    );
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

const historyQuery = z.object({
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => DateTime.fromISO(s, { zone: 'utc' }).isValid)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

sessionsRouter.get(
  '/patients/:id/sessions',
  requirePerm('sessions.view'),
  validate(historyQuery, 'query'),
  async (req, res, next) => {
    try {
      const { before, limit } = req.query as unknown as z.infer<typeof historyQuery>;
      const patient = await loadPatientInCentre(centreOf(req), req.params.id);
      const sessions = await Session.find({
        patientId: patient._id,
        status: { $ne: 'scheduled' },
        ...(before ? { date: { $lt: before } } : {}),
      });
      const shifts = await Shift.find({ _id: { $in: sessions.map((s) => s.shiftId) } });
      const start = (s: SessionDoc) => shifts.find((x) => String(x._id) === String(s.shiftId))?.start ?? '';
      sessions.sort((a, b) => (a.date === b.date ? start(b).localeCompare(start(a)) : b.date.localeCompare(a.date)));
      const page = sessions.slice(0, limit);
      const centres = await Centre.find({ _id: { $in: page.map((s) => s.centreId) } });
      const items = [];
      for (const s of page) {
        const centreName = centres.find((c) => String(c._id) === String(s.centreId))?.name ?? '';
        items.push({ ...(await historyOf(s)), centreId: String(s.centreId), centreName });
      }
      res.json(items);
    } catch (e) {
      next(e);
    }
  },
);

sessionsRouter.get(
  '/patients/:id/timeline',
  requirePerm('sessions.view'),
  validate(historyQuery, 'query'),
  async (req, res, next) => {
    try {
      const { before, limit } = req.query as unknown as z.infer<typeof historyQuery>;
      const patient = await loadPatientInCentre(centreOf(req), req.params.id);
      res.json(await buildTimeline(patient._id, { kind: 'staff', centreId: centreOf(req) }, { before, limit }));
    } catch (e) {
      next(e);
    }
  },
);
