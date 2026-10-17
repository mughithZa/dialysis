import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { GLOBAL_PERMISSIONS, PERMISSIONS, type Permission } from '@dialysis/shared';
import { validate } from '../lib/validate.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { recordAudit } from '../audit/record.js';
import { requireAuth, requirePerm } from './middleware.js';
import { Role } from './role.model.js';

export const rolesRouter = Router();
export const permissionsRouter = Router();

const ALL = PERMISSIONS.map((p) => p.key) as [Permission, ...Permission[]];
const roleDto = (r: { id?: string; key: string; name: string; scope: string; permissions: string[]; system: boolean }) => ({
  id: r.id,
  key: r.key,
  name: r.name,
  scope: r.scope,
  permissions: [...r.permissions],
  system: r.system,
});

/** Centre-scope roles can never carry a global permission (the model hook only guards save, so check up front). */
const assertNoGlobalPerms = (perms: string[]) => {
  if (perms.some((p) => GLOBAL_PERMISSIONS.includes(p as Permission))) throw badRequest('global_perm_in_centre_role');
};

rolesRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    if (req.user!.kind !== 'staff') throw new HttpError(403, 'forbidden');
    res.json((await Role.find().sort({ name: 1 })).map(roleDto));
  } catch (e) {
    next(e);
  }
});

permissionsRouter.get('/', requireAuth, (req, res, next) => {
  try {
    if (req.user!.kind !== 'staff') throw new HttpError(403, 'forbidden');
    res.json(PERMISSIONS.map((p) => ({ key: p.key, category: p.category })));
  } catch (e) {
    next(e);
  }
});

const createBody = z.object({
  name: z.string().trim().min(1),
  permissions: z.array(z.enum(ALL)),
});

rolesRouter.post('/', requirePerm('roles.edit'), validate(createBody), async (req, res, next) => {
  try {
    const { name, permissions } = req.body as z.infer<typeof createBody>;
    assertNoGlobalPerms(permissions);
    const role = await Role.create({
      key: `custom_${new mongoose.Types.ObjectId().toHexString()}`,
      name,
      scope: 'centre',
      permissions: [...new Set(permissions)],
    });
    await recordAudit(req, 'role.create', 'role', role.id, { name, permissions: role.permissions });
    res.status(201).json(roleDto(role));
  } catch (e) {
    next(e);
  }
});

const patchBody = z.object({
  name: z.string().trim().min(1).optional(),
  permissions: z.array(z.enum(ALL)).optional(),
});

rolesRouter.patch('/:id', requirePerm('roles.edit'), validate(patchBody), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const role = mongoose.isValidObjectId(id) ? await Role.findById(id) : null;
    if (!role) throw notFound();
    if (role.key === 'program_manager' || role.scope === 'global') throw new HttpError(403, 'system_role_locked');
    const { name, permissions } = req.body as z.infer<typeof patchBody>;
    if (permissions) assertNoGlobalPerms(permissions);
    if (name !== undefined) role.name = name;
    if (permissions) role.set('permissions', [...new Set(permissions)]);
    await role.save(); // load-mutate-save so the model's validation hook runs
    await recordAudit(req, 'role.edit', 'role', role.id, { name, permissions });
    res.json(roleDto(role));
  } catch (e) {
    next(e);
  }
});
