import { Router, type Request } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { recordAudit } from '../audit/record.js';
import { requirePerm } from '../auth/middleware.js';
import { withTransaction } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { todayLocal } from '../lib/dates.js';
import { validate } from '../lib/validate.js';
import { loadPatientInCentre } from '../patients/load.js';
import { Order, ORDER_STATUSES } from './order.model.js';
import { toOrderDtos } from './service.js';

export const ordersRouter = Router({ mergeParams: true });

const centreOf = (req: Request) => String(req.params.centreId);
const listQuery = z.object({ status: z.enum(ORDER_STATUSES).optional() });
const createBody = z.object({
  text: z.string().trim().min(1).max(2000),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => !Number.isNaN(Date.parse(s)))
    .optional(),
});

ordersRouter.get('/patients/:id/orders', requirePerm('orders.view'), validate(listQuery, 'query'), async (req, res, next) => {
  try {
    const { status } = req.query as unknown as z.infer<typeof listQuery>;
    const patient = await loadPatientInCentre(centreOf(req), req.params.id);
    const orders = await Order.find({ patientId: patient._id, ...(status ? { status } : {}) }).sort({ from: -1, _id: -1 });
    res.json(await toOrderDtos(orders));
  } catch (e) {
    next(e);
  }
});

ordersRouter.post('/patients/:id/orders', requirePerm('orders.write'), validate(createBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof createBody>;
    const patient = await loadPatientInCentre(centreOf(req), req.params.id);
    const order = await withTransaction(async (tx) => {
      const [o] = await Order.create(
        [{ patientId: patient._id, centreId: centreOf(req), doctorId: req.user!._id, text: b.text, from: b.from ?? todayLocal() }],
        { session: tx },
      );
      await recordAudit(req, 'order.create', 'order', o!.id, { patientId: patient.id }, tx);
      return o!;
    });
    res.status(201).json((await toOrderDtos([order]))[0]);
  } catch (e) {
    next(e);
  }
});

ordersRouter.post('/patients/:id/orders/:oid/end', requirePerm('orders.write'), async (req, res, next) => {
  try {
    const patient = await loadPatientInCentre(centreOf(req), req.params.id);
    const oid = String(req.params.oid);
    const found = mongoose.isValidObjectId(oid) ? await Order.findById(oid) : null;
    if (!found || String(found.patientId) !== patient.id) throw notFound();
    const ended = await withTransaction(async (tx) => {
      const o = await Order.findOneAndUpdate(
        { _id: found._id, status: 'active' },
        { $set: { status: 'ended', endedAt: new Date() } },
        { new: true, session: tx },
      );
      if (!o) throw conflict('already_ended');
      await recordAudit(req, 'order.end', 'order', o.id, { patientId: patient.id }, tx);
      return o;
    });
    res.json((await toOrderDtos([ended]))[0]);
  } catch (e) {
    next(e);
  }
});
