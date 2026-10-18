import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { validate } from '../lib/validate.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { withTransaction } from '../db.js';
import { recordAudit } from '../audit/record.js';
import { requireAuth, requirePerm } from '../auth/middleware.js';
import { effectivePermissions } from '../auth/effective.js';
import { Role } from '../auth/role.model.js';
import { User } from '../auth/user.model.js';
import { hashPassword } from '../auth/password.js';
import { Centre } from './centre.model.js';
import { Chair } from './chair.model.js';
import { Shift } from './shift.model.js';
import { countActivePatients } from './active-patients.js';
import { refreshAfterSave } from '../schedule/generate.js';

export const centresRouter = Router();

const isDuplicateKey = (e: unknown) => (e as { code?: number }).code === 11000;
const validId = (id: unknown): id is string => typeof id === 'string' && mongoose.isValidObjectId(id);
const centreDto = (c: { id?: string; name: string; status: string }) => ({ id: c.id, name: c.name, status: c.status });

async function findCentre(id: unknown) {
  const centre = validId(id) ? await Centre.findById(id) : null;
  if (!centre) throw notFound();
  return centre;
}

// ---------- Program manager (global permissions; closed centres stay reachable) ----------

centresRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const user = req.user!;
    if ((await effectivePermissions(user, null)).has('stats.global')) {
      res.json((await Centre.find().sort({ name: 1 })).map(centreDto));
      return;
    }
    if (!user.memberships.length) throw forbidden();
    const centres = await Centre.find({
      _id: { $in: user.memberships.map((m) => m.centreId) },
      status: 'active',
    }).sort({ name: 1 });
    res.json(centres.map(centreDto));
  } catch (e) {
    next(e);
  }
});

const createBody = z.object({
  name: z.string().trim().min(1),
  manager: z.object({
    username: z.string().trim().min(1),
    password: z.string().min(8),
    name: z.string().trim().min(1),
    phone: z.string().trim().min(1).optional(),
  }),
});

centresRouter.post('/', requirePerm('centres.create'), validate(createBody), async (req, res, next) => {
  try {
    const { name, manager } = req.body as z.infer<typeof createBody>;
    const role = await Role.findOne({ key: 'centre_manager' });
    if (!role) throw new Error('centre_manager role missing (seedRoles first)');
    const passwordHash = await hashPassword(manager.password);
    let out;
    try {
      out = await withTransaction(async (session) => {
        const [centre] = await Centre.create([{ name }], { session });
        const [user] = await User.create(
          [
            {
              username: manager.username,
              passwordHash,
              name: manager.name,
              phone: manager.phone,
              kind: 'staff',
              memberships: [{ centreId: centre!._id, roleIds: [role._id] }],
            },
          ],
          { session },
        );
        await recordAudit(req, 'centre.create', 'centre', centre!.id, { name, managerId: user!.id }, session);
        return { centre: centre!, managerId: user!.id as string };
      });
    } catch (e) {
      if (isDuplicateKey(e)) throw conflict('username_taken');
      throw e;
    }
    res.status(201).json({ centre: centreDto(out.centre), managerId: out.managerId });
  } catch (e) {
    next(e);
  }
});

centresRouter.post('/:id/close', requirePerm('centres.close'), async (req, res, next) => {
  try {
    const centre = await findCentre(req.params.id);
    if ((await countActivePatients(centre.id)) > 0) throw conflict('has_active_patients');
    centre.status = 'closed';
    await centre.save();
    await recordAudit(req, 'centre.close', 'centre', centre.id);
    res.json(centreDto(centre));
  } catch (e) {
    next(e);
  }
});

centresRouter.post('/:id/reopen', requirePerm('centres.close'), async (req, res, next) => {
  try {
    const centre = await findCentre(req.params.id);
    centre.status = 'active';
    await centre.save();
    await recordAudit(req, 'centre.reopen', 'centre', centre.id);
    res.json(centreDto(centre));
  } catch (e) {
    next(e);
  }
});

/** Users holding `centre_manager` in the centre. */
async function managerFilter(centreId: string, extra: object = {}) {
  const role = await Role.findOne({ key: 'centre_manager' });
  return {
    ...extra,
    kind: 'staff',
    memberships: { $elemMatch: { centreId, roleIds: role?._id ?? null } },
  };
}

centresRouter.get('/:id/managers', requirePerm('managers.manage'), async (req, res, next) => {
  try {
    const centre = await findCentre(req.params.id);
    const users = await User.find(await managerFilter(centre.id)).sort({ username: 1 });
    res.json(users.map((u) => ({ id: u.id, username: u.username, name: u.name, phone: u.phone, active: u.active })));
  } catch (e) {
    next(e);
  }
});

const resetBody = z.object({ password: z.string().min(8) });

centresRouter.post(
  '/:id/managers/:userId/reset-password',
  requirePerm('managers.manage'),
  validate(resetBody),
  async (req, res, next) => {
    try {
      const centre = await findCentre(req.params.id);
      const userId = req.params.userId;
      const user = validId(userId) ? await User.findOne(await managerFilter(centre.id, { _id: userId })) : null;
      if (!user) throw notFound();
      user.passwordHash = await hashPassword((req.body as z.infer<typeof resetBody>).password);
      await user.save();
      await recordAudit(req, 'manager.resetPassword', 'user', user.id, { centreId: centre.id });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

// ---------- Centre-scoped (centre manager and schedule viewers) ----------

const settingsDto = (c: { settings?: { patientsSeeNotes?: boolean | null; reminderHours?: number | null } | null }) => ({
  patientsSeeNotes: c.settings?.patientsSeeNotes ?? false,
  reminderHours: c.settings?.reminderHours ?? 24,
});

centresRouter.get('/:centreId/settings', requirePerm('settings.centre'), async (req, res, next) => {
  try {
    res.json(settingsDto(await findCentre(req.params.centreId)));
  } catch (e) {
    next(e);
  }
});

const settingsBody = z
  .object({ patientsSeeNotes: z.boolean(), reminderHours: z.number().int().min(1).max(72) })
  .partial()
  .refine((b) => Object.keys(b).length > 0);

centresRouter.patch('/:centreId/settings', requirePerm('settings.centre'), validate(settingsBody), async (req, res, next) => {
  try {
    const centre = await findCentre(req.params.centreId);
    const body = req.body as z.infer<typeof settingsBody>;
    if (body.patientsSeeNotes !== undefined) centre.set('settings.patientsSeeNotes', body.patientsSeeNotes);
    if (body.reminderHours !== undefined) centre.set('settings.reminderHours', body.reminderHours);
    await centre.save();
    await recordAudit(req, 'settings.update', 'centre', centre.id, body);
    res.json(settingsDto(centre));
  } catch (e) {
    next(e);
  }
});

const chairDto = (c: { id?: string; label: string; active: boolean }) => ({ id: c.id, label: c.label, active: c.active });

centresRouter.get('/:centreId/chairs', requirePerm('schedule.view'), async (req, res, next) => {
  try {
    const chairs = await Chair.find({ centreId: req.params.centreId }).sort({ _id: 1 });
    res.json(chairs.map(chairDto));
  } catch (e) {
    next(e);
  }
});

// Machine count, retirement and blocks are written through /schedule/setup only; here a machine can be renamed.
const chairPatch = z.object({ label: z.string().trim().min(1) }).strict();

centresRouter.patch('/:centreId/chairs/:id', requirePerm('schedule.setup'), validate(chairPatch), async (req, res, next) => {
  try {
    const id = req.params.id;
    const centreId = String(req.params.centreId);
    const chair = validId(id) ? await Chair.findOne({ _id: id, centreId }) : null;
    if (!chair) throw notFound();
    const body = req.body as z.infer<typeof chairPatch>;
    const renamed = chair.label !== body.label;
    chair.set(body);
    await chair.save().catch((e: unknown) => {
      throw isDuplicateKey(e) ? conflict('chair_exists') : e;
    });
    await recordAudit(req, 'chair.update', 'chair', chair.id, body);
    if (renamed) await refreshAfterSave(centreId);
    res.json(chairDto(chair));
  } catch (e) {
    next(e);
  }
});

const shiftDto = (s: { id?: string; name: string; start: string; end: string; active: boolean }) => ({
  id: s.id,
  name: s.name,
  start: s.start,
  end: s.end,
  active: s.active,
});

centresRouter.get('/:centreId/shifts', requirePerm('schedule.view'), async (req, res, next) => {
  try {
    const shifts = await Shift.find({ centreId: req.params.centreId }).sort({ _id: 1 });
    res.json(shifts.map(shiftDto));
  } catch (e) {
    next(e);
  }
});
