import type { Request, RequestHandler, Response } from 'express';
import mongoose from 'mongoose';
import { GLOBAL_PERMISSIONS, type Permission } from '@dialysis/shared';
import { HttpError, forbidden, notFound } from '../lib/errors.js';
import { Centre } from '../centres/centre.model.js';
import { User, type UserDoc } from './user.model.js';
import { effectivePermissions } from './effective.js';

declare module 'express-session' {
  interface SessionData {
    userId: string;
  }
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDoc;
      perms?: Set<Permission>;
    }
  }
}

/** Loads the active session user onto req.user, or throws 401. */
async function loadUser(req: Request): Promise<UserDoc> {
  const id = req.session.userId;
  const user = id && mongoose.isValidObjectId(id) ? await User.findById(id) : null;
  if (!user || !user.active) throw new HttpError(401, 'unauthorized');
  req.user = user;
  return user;
}

const guard =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  async (req, res, next) => {
    try {
      await fn(req, res);
      next();
    } catch (e) {
      next(e);
    }
  };

export const requireAuth: RequestHandler = guard(async (req) => {
  await loadUser(req);
});

export const requirePatient: RequestHandler = guard(async (req) => {
  const user = await loadUser(req);
  if (user.kind !== 'patient') throw forbidden();
});

/**
 * Global permissions are checked without a centre; centre permissions use req.params.centreId.
 * 403 when the permission is missing (checked first, so non-members learn nothing about a centre);
 * 404 when the centre is closed or gone.
 */
export function requirePerm(perm: Permission): RequestHandler {
  const isGlobal = GLOBAL_PERMISSIONS.includes(perm);
  return guard(async (req) => {
    const user = await loadUser(req);
    const centreId = isGlobal ? null : String(req.params.centreId ?? '');
    if (centreId !== null && !mongoose.isValidObjectId(centreId)) throw forbidden();
    const perms = await effectivePermissions(user, centreId);
    if (!perms.has(perm)) throw forbidden();
    if (centreId !== null) {
      const centre = await Centre.findById(centreId);
      if (!centre || centre.status === 'closed') throw notFound();
    }
    req.perms = perms;
  });
}
