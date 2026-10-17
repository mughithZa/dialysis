import { Router, type Request, type RequestHandler } from 'express';
import mongoose, { type HydratedDocument } from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS, type Permission } from '@dialysis/shared';
import { validate } from '../lib/validate.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { withTransaction } from '../db.js';
import { recordAudit } from '../audit/record.js';
import { requireAuth, requirePerm } from '../auth/middleware.js';
import { effectivePermissions } from '../auth/effective.js';
import { Centre } from '../centres/centre.model.js';
import { Role, type RoleDoc } from '../auth/role.model.js';
import { User, type UserDoc } from '../auth/user.model.js';
import { hashPassword } from '../auth/password.js';

export const usersRouter = Router({ mergeParams: true });

type RoleRow = HydratedDocument<RoleDoc>;

const isDuplicateKey = (e: unknown) => (e as { code?: number }).code === 11000;
const validId = (id: unknown): id is string => typeof id === 'string' && mongoose.isValidObjectId(id);

/** Categories whose permissions are privileged: only someone who holds them may hand them on. */
const PRIVILEGED_CATEGORIES = new Set(['Users & roles', 'Centre settings', 'Reports & audit']);
const PRIVILEGED = new Set<string>(PERMISSIONS.filter((p) => PRIVILEGED_CATEGORIES.has(p.category)).map((p) => p.key));

/**
 * 403 cannot_grant when a role is global-scope, or carries a privileged permission
 * (users/roles, centre settings, reports/audit) that the granter does not hold in this centre.
 * Clinical and operational permissions may be granted freely by anyone allowed to manage users.
 */
export function assertCanGrant(granterPerms: Set<Permission>, roles: Pick<RoleRow, 'scope' | 'permissions'>[]): void {
  for (const role of roles) {
    if (role.scope !== 'centre') throw new HttpError(403, 'cannot_grant');
    for (const p of role.permissions) {
      if (PRIVILEGED.has(p) && !granterPerms.has(p as Permission)) throw new HttpError(403, 'cannot_grant');
    }
  }
}

async function rolesByKeys(keys: string[]): Promise<RoleRow[]> {
  const unique = [...new Set(keys)];
  const roles = await Role.find({ key: { $in: unique } });
  if (roles.length !== unique.length) throw badRequest('unknown_role');
  return roles;
}

/** A staff user (no global roles) who is a member of this centre; anything else is 404. */
async function findMember(centreId: string, id: unknown): Promise<UserDoc> {
  const user = validId(id) ? await User.findById(id) : null;
  if (
    !user ||
    user.kind !== 'staff' ||
    user.globalRoleIds.length ||
    !user.memberships.some((m) => String(m.centreId) === centreId)
  ) {
    throw notFound();
  }
  return user;
}

const membership = (user: UserDoc, centreId: string) => user.memberships.find((m) => String(m.centreId) === centreId);

/** Requires any one of the given permissions in the route's centre. */
function requireAnyPerm(perms: Permission[]): RequestHandler {
  return async (req, res, next) => {
    requireAuth(req, res, async (err?: unknown) => {
      if (err) return next(err);
      try {
        const centreId = String(req.params.centreId ?? '');
        if (!validId(centreId)) throw forbidden();
        const held = await effectivePermissions(req.user!, centreId);
        if (!perms.some((p) => held.has(p))) throw forbidden();
        const centre = await Centre.findById(centreId);
        if (!centre || centre.status === 'closed') throw notFound();
        req.perms = held;
        next();
      } catch (e) {
        next(e);
      }
    });
  };
}

const userDto = (u: UserDoc, centreId: string, roleKeyById: Map<string, string>) => ({
  id: u.id as string,
  username: u.username,
  name: u.name,
  phone: u.phone ?? null,
  active: u.active,
  roleKeys: (membership(u, centreId)?.roleIds ?? []).map((r) => roleKeyById.get(String(r))).filter(Boolean),
});

async function roleKeyMap(): Promise<Map<string, string>> {
  return new Map((await Role.find()).map((r) => [String(r._id), r.key]));
}

const centreOf = (req: Request) => String(req.params.centreId);

usersRouter.get('/', requireAnyPerm(['users.edit', 'schedule.assignNurses', 'users.create']), async (req, res, next) => {
  try {
    const centreId = centreOf(req);
    const users = await User.find({
      kind: 'staff',
      'globalRoleIds.0': { $exists: false },
      'memberships.centreId': centreId,
    }).sort({ name: 1 });
    const keys = await roleKeyMap();
    res.json(users.map((u) => userDto(u, centreId, keys)));
  } catch (e) {
    next(e);
  }
});

const password = z.string().min(8);
const roleKeys = z.array(z.string().min(1)).min(1);

const createBody = z.object({
  username: z.string().trim().min(1),
  password,
  name: z.string().trim().min(1),
  phone: z.string().trim().min(1).optional(),
  roleKeys,
});

usersRouter.post('/', requirePerm('users.create'), validate(createBody), async (req, res, next) => {
  try {
    const centreId = centreOf(req);
    const b = req.body as z.infer<typeof createBody>;
    const roles = await rolesByKeys(b.roleKeys);
    assertCanGrant(req.perms!, roles);
    const passwordHash = await hashPassword(b.password);
    let created: UserDoc;
    try {
      created = await withTransaction(async (session) => {
        const [user] = await User.create(
          [
            {
              username: b.username,
              passwordHash,
              name: b.name,
              phone: b.phone,
              kind: 'staff',
              memberships: [{ centreId, roleIds: roles.map((r) => r._id) }],
            },
          ],
          { session },
        );
        await recordAudit(req, 'user.create', 'user', user!.id, { username: b.username, roleKeys: b.roleKeys }, session);
        return user!;
      });
    } catch (e) {
      if (isDuplicateKey(e)) throw conflict('username_taken');
      throw e;
    }
    res.status(201).json(userDto(created, centreId, await roleKeyMap()));
  } catch (e) {
    next(e);
  }
});

// Declared before '/:id' routes so "lookup" is not read as an id.
const lookupQuery = z.object({ phone: z.string().trim().min(1) });

usersRouter.get('/lookup', requirePerm('users.create'), validate(lookupQuery, 'query'), async (req, res, next) => {
  try {
    const { phone } = req.query as unknown as z.infer<typeof lookupQuery>;
    const users = await User.find({
      phone,
      kind: 'staff',
      active: true,
      'globalRoleIds.0': { $exists: false },
    });
    res.json(users.map((u) => ({ id: u.id as string, name: u.name })));
  } catch (e) {
    next(e);
  }
});

const patchBody = z.object({
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(1).optional(),
  active: z.boolean().optional(),
  roleKeys: roleKeys.optional(),
});

usersRouter.patch('/:id', requirePerm('users.edit'), validate(patchBody), async (req, res, next) => {
  try {
    const centreId = centreOf(req);
    const b = req.body as z.infer<typeof patchBody>;
    const user = await findMember(centreId, req.params.id);
    let roleIds;
    if (b.roleKeys) {
      if (!req.perms!.has('roles.assign')) throw forbidden();
      const roles = await rolesByKeys(b.roleKeys);
      assertCanGrant(req.perms!, roles);
      roleIds = roles.map((r) => r._id);
    }
    if (b.name !== undefined) user.name = b.name;
    if (b.phone !== undefined) user.phone = b.phone;
    if (b.active !== undefined) user.active = b.active;
    if (roleIds) membership(user, centreId)!.roleIds = roleIds;
    await withTransaction(async (session) => {
      await user.save({ session });
      await recordAudit(req, 'user.edit', 'user', user.id, b, session);
    });
    res.json(userDto(user, centreId, await roleKeyMap()));
  } catch (e) {
    next(e);
  }
});

const resetBody = z.object({ password });

usersRouter.post('/:id/reset-password', requirePerm('users.resetPassword'), validate(resetBody), async (req, res, next) => {
  try {
    const user = await findMember(centreOf(req), req.params.id);
    user.passwordHash = await hashPassword((req.body as z.infer<typeof resetBody>).password);
    await withTransaction(async (session) => {
      await user.save({ session });
      await recordAudit(req, 'user.resetPassword', 'user', user.id, undefined, session);
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

const linkBody = z.object({ roleKeys });

usersRouter.post('/:id/link', requirePerm('users.create'), validate(linkBody), async (req, res, next) => {
  try {
    const centreId = centreOf(req);
    const user = validId(req.params.id) ? await User.findById(req.params.id) : null;
    if (!user || user.kind !== 'staff' || user.globalRoleIds.length || !user.active) throw notFound();
    if (membership(user, centreId)) throw conflict('already_member');
    const b = req.body as z.infer<typeof linkBody>;
    const roles = await rolesByKeys(b.roleKeys);
    assertCanGrant(req.perms!, roles);
    user.memberships.push({ centreId: new mongoose.Types.ObjectId(centreId), roleIds: roles.map((r) => r._id) });
    await withTransaction(async (session) => {
      await user.save({ session });
      await recordAudit(req, 'user.link', 'user', user.id, { roleKeys: b.roleKeys }, session);
    });
    res.json(userDto(user, centreId, await roleKeyMap()));
  } catch (e) {
    next(e);
  }
});
