import { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { requirePerm } from '../auth/middleware.js';
import { Centre } from '../centres/centre.model.js';
import { validate } from '../lib/validate.js';
import { centreStats } from './stats.js';

const monthQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .refine((m) => DateTime.fromISO(`${m}-01`).isValid),
});
const monthOf = (q: unknown) => (q as z.infer<typeof monthQuery>).month;

/** Program-manager dashboard: every centre (closed included); aggregates only. */
export const statsRouter = Router();
statsRouter.get('/', requirePerm('stats.global'), validate(monthQuery, 'query'), async (req, res, next) => {
  try {
    const centres = await Centre.find({}, { _id: 1 });
    res.json(await centreStats(centres.map((c) => c._id), monthOf(req.query)));
  } catch (e) {
    next(e);
  }
});

export const centreStatsRouter = Router({ mergeParams: true });
centreStatsRouter.get('/stats', requirePerm('reports.centre'), validate(monthQuery, 'query'), async (req, res, next) => {
  try {
    const centre = await Centre.findById(req.params.centreId, { _id: 1 });
    const [stats] = await centreStats(centre ? [centre._id] : [], monthOf(req.query));
    res.json(stats);
  } catch (e) {
    next(e);
  }
});
