import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { validate } from '../lib/validate.js';
import { requirePerm } from '../auth/middleware.js';
import { AuditEntry } from './audit.model.js';

export const auditRouter = Router({ mergeParams: true });

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => DateTime.fromISO(s).isValid);
const querySchema = z.object({
  userId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  from: localDate.optional(),
  to: localDate.optional(),
});

auditRouter.get('/', requirePerm('audit.view'), validate(querySchema, 'query'), async (req, res, next) => {
  try {
    const q = req.query as z.infer<typeof querySchema>;
    const filter: Record<string, unknown> = { centreId: req.params.centreId };
    if (q.userId) filter.userId = q.userId;
    const at: Record<string, Date> = {};
    if (q.from) at.$gte = DateTime.fromISO(q.from, { zone: config.appTz }).startOf('day').toJSDate();
    if (q.to) at.$lt = DateTime.fromISO(q.to, { zone: config.appTz }).plus({ days: 1 }).startOf('day').toJSDate();
    if (q.from || q.to) filter.at = at;
    const rows = await AuditEntry.find(filter)
      .sort({ at: -1, _id: -1 })
      .limit(200)
      .populate<{ userId: { _id: unknown; name: string } | null }>('userId', 'name');
    res.json(
      rows.map((r) => ({
        at: r.at,
        user: { id: String(r.userId?._id), name: r.userId?.name ?? '' },
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        details: r.details,
      })),
    );
  } catch (e) {
    next(e);
  }
});
