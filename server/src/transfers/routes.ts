import { Router, type Request, type RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { recordAudit } from '../audit/record.js';
import { requirePerm } from '../auth/middleware.js';
import { Centre } from '../centres/centre.model.js';
import { withTransaction } from '../db.js';
import { badRequest, conflict } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { loadPatientInCentre } from '../patients/load.js';
import { Patient } from '../patients/patient.model.js';
import { decide, loadTransfer, moveToTarget } from './service.js';
import { Transfer, type TransferDoc } from './transfer.model.js';

export const transfersRouter = Router({ mergeParams: true });

const centreOf = (req: Request) => String(req.params.centreId);
const isDuplicateKey = (e: unknown) => (e as { code?: number }).code === 11000;

/** Passes when the user holds either permission in this centre. */
const requireAnyPerm = (a: 'transfers.send', b: 'transfers.decide'): RequestHandler => {
  const first = requirePerm(a);
  const second = requirePerm(b);
  return (req, res, next) => first(req, res, (err) => (err ? second(req, res, next) : next()));
};

transfersRouter.get('/transfer-targets', requirePerm('transfers.send'), async (req, res, next) => {
  try {
    const centres = await Centre.find({ status: 'active', _id: { $ne: centreOf(req) } }).sort({ name: 1 });
    res.json(centres.map((c) => ({ id: c.id as string, name: c.name })));
  } catch (e) {
    next(e);
  }
});

const sendBody = z.object({ toCentreId: z.string(), note: z.string().trim().min(1).max(1000).optional() });

transfersRouter.post('/patients/:id/transfer', requirePerm('transfers.send'), validate(sendBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof sendBody>;
    const from = centreOf(req);
    const patient = await loadPatientInCentre(from, req.params.id);
    const target =
      mongoose.isValidObjectId(b.toCentreId) && b.toCentreId !== from ? await Centre.findById(b.toCentreId) : null;
    if (!target || target.status !== 'active') throw badRequest('bad_target');
    if (patient.status !== 'active') throw conflict('patient_not_active');
    let created: TransferDoc;
    try {
      created = await withTransaction(async (session) => {
        const moved = await Patient.updateOne(
          { _id: patient._id, centreId: from, status: 'active' },
          { $set: { status: 'transferring' } },
          { session },
        );
        if (!moved.modifiedCount) throw conflict('patient_not_active');
        const [t] = await Transfer.create(
          [{ patientId: patient._id, fromCentreId: from, toCentreId: target._id, note: b.note, sentBy: req.user!._id }],
          { session },
        );
        await recordAudit(req, 'transfer.send', 'transfer', t!.id, { patientId: patient.id, toCentreId: b.toCentreId }, session);
        return t!;
      });
    } catch (e) {
      if (isDuplicateKey(e)) throw conflict('transfer_pending');
      throw e;
    }
    res.status(201).json({ id: created.id as string, status: created.status });
  } catch (e) {
    next(e);
  }
});

transfersRouter.post('/transfers/:tid/cancel', requirePerm('transfers.send'), async (req, res, next) => {
  try {
    const t = await loadTransfer(centreOf(req), req.params.tid, 'from');
    await withTransaction(async (session) => {
      await decide(t, 'cancelled', req.user!._id, session);
      await Patient.updateOne({ _id: t.patientId, status: 'transferring' }, { $set: { status: 'active' } }, { session });
      await recordAudit(req, 'transfer.cancel', 'transfer', t.id, { patientId: String(t.patientId) }, session);
    });
    res.json({ id: t.id as string, status: 'cancelled' });
  } catch (e) {
    next(e);
  }
});

const listQuery = z.object({ direction: z.enum(['incoming', 'outgoing']) });

transfersRouter.get(
  '/transfers',
  requireAnyPerm('transfers.send', 'transfers.decide'),
  validate(listQuery, 'query'),
  async (req, res, next) => {
    try {
      const { direction } = req.query as unknown as z.infer<typeof listQuery>;
      const incoming = direction === 'incoming';
      const transfers = await Transfer.find(incoming ? { toCentreId: centreOf(req) } : { fromCentreId: centreOf(req) }).sort({
        sentAt: -1,
      });
      const centreIds = transfers.map((t) => (incoming ? t.fromCentreId : t.toCentreId));
      const centres = await Centre.find({ _id: { $in: centreIds } });
      const nameOf = (id: unknown) => centres.find((c) => String(c._id) === String(id))?.name ?? '';
      const patients = incoming ? await Patient.find({ _id: { $in: transfers.map((t) => t.patientId) } }) : [];
      res.json(
        transfers.map((t) => {
          const base = { id: t.id as string, status: t.status, sentAt: t.sentAt, note: t.note ?? null };
          if (!incoming) {
            return {
              ...base,
              toCentre: { id: String(t.toCentreId), name: nameOf(t.toCentreId) },
              rejectReason: t.rejectReason ?? null,
            };
          }
          const p = patients.find((x) => String(x._id) === String(t.patientId));
          return {
            ...base,
            fromCentre: { id: String(t.fromCentreId), name: nameOf(t.fromCentreId) },
            patient: { name: p?.name ?? '', phone: p?.phone ?? null, kidneyFailureCause: p?.kidneyFailureCause ?? null },
          };
        }),
      );
    } catch (e) {
      next(e);
    }
  },
);

transfersRouter.post('/transfers/:tid/accept', requirePerm('transfers.decide'), async (req, res, next) => {
  try {
    const t = await loadTransfer(centreOf(req), req.params.tid, 'to');
    await withTransaction(async (session) => {
      await decide(t, 'accepted', req.user!._id, session);
      await moveToTarget(t, session);
      await recordAudit(req, 'transfer.accept', 'transfer', t.id, { patientId: String(t.patientId) }, session);
    });
    res.json({ id: t.id as string, status: 'accepted' });
  } catch (e) {
    next(e);
  }
});

const rejectBody = z.object({ reason: z.string().trim().min(1).max(1000) });

transfersRouter.post('/transfers/:tid/reject', requirePerm('transfers.decide'), validate(rejectBody), async (req, res, next) => {
  try {
    const { reason } = req.body as z.infer<typeof rejectBody>;
    const t = await loadTransfer(centreOf(req), req.params.tid, 'to');
    await withTransaction(async (session) => {
      await decide(t, 'rejected', req.user!._id, session, { rejectReason: reason });
      await Patient.updateOne({ _id: t.patientId, status: 'transferring' }, { $set: { status: 'active' } }, { session });
      await recordAudit(req, 'transfer.reject', 'transfer', t.id, { patientId: String(t.patientId), reason }, session);
    });
    res.json({ id: t.id as string, status: 'rejected' });
  } catch (e) {
    next(e);
  }
});
