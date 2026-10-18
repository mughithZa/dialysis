import { Router, type Request } from 'express';
import { z } from 'zod';
import { validate } from '../lib/validate.js';
import { withTransaction } from '../db.js';
import { recordAudit } from '../audit/record.js';
import { requirePerm } from '../auth/middleware.js';
import { refreshAfterSave } from './generate.js';
import { applySetup, getSetup } from './setup.js';

export const setupRouter = Router({ mergeParams: true });

const centreOf = (req: Request) => String(req.params.centreId);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const putBody = z.object({
  machineCount: z.number().int().min(1).max(100),
  blocks: z
    .array(z.object({ id: z.string().min(1).optional(), name: z.string().trim().min(1), start: hhmm, end: hhmm }))
    .min(1)
    .max(6),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});

setupRouter.get('/schedule/setup', requirePerm('schedule.view'), async (req, res, next) => {
  try {
    res.json(await getSetup(centreOf(req)));
  } catch (e) {
    next(e);
  }
});

setupRouter.put('/schedule/setup', requirePerm('schedule.setup'), validate(putBody), async (req, res, next) => {
  try {
    const centreId = centreOf(req);
    const input = req.body as z.infer<typeof putBody>;
    const { dto, timesChanged } = await withTransaction(async (session) => {
      const out = await applySetup(centreId, input, session);
      await recordAudit(
        req,
        'schedule.setup',
        'centre',
        centreId,
        { machineCount: input.machineCount, blocks: input.blocks.length, workingDays: input.workingDays },
        session,
      );
      return out;
    });
    // after commit: a failed refresh must not turn a saved setup into an error (the nightly run refreshes again)
    if (timesChanged) await refreshAfterSave(centreId);
    res.json(dto);
  } catch (e) {
    next(e);
  }
});
