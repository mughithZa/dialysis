import { Router } from 'express';
import { z } from 'zod';
import { LANGUAGES, type MeDto } from '@dialysis/shared';
import { validate } from '../lib/validate.js';
import { HttpError } from '../lib/errors.js';
import { Centre } from '../centres/centre.model.js';
import { User, type UserDoc } from './user.model.js';
import { verifyPassword } from './password.js';
import { effectivePermissions } from './effective.js';
import { requireAuth } from './middleware.js';

export const authRouter = Router();

const badCredentials = () => new HttpError(401, 'bad_credentials');

/** Closed centres are excluded; centre permissions never include global-scope roles. */
async function buildMe(user: UserDoc): Promise<MeDto> {
  const globalPermissions = [...(await effectivePermissions(user, null))];
  const centres = await Centre.find({
    _id: { $in: user.memberships.map((m) => m.centreId) },
    status: 'active',
  });
  const out: MeDto['centres'] = [];
  for (const c of centres) {
    const permissions = [...(await effectivePermissions({ globalRoleIds: [], memberships: user.memberships }, c.id))];
    out.push({ id: c.id, name: c.name, permissions });
  }
  return { id: user.id, name: user.name, kind: user.kind, language: user.language ?? null, globalPermissions, centres: out };
}

const loginBody = z.object({ username: z.string().min(1), password: z.string().min(1) });

authRouter.post('/login', validate(loginBody), async (req, res, next) => {
  try {
    const { username, password } = req.body as z.infer<typeof loginBody>;
    const user = await User.findOne({ username: username.trim().toLowerCase() });
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) throw badCredentials();
    const me = await buildMe(user);
    // Staff whose every centre is closed (and with no global role) have nowhere to go.
    if (!user.globalRoleIds.length && user.memberships.length && !me.centres.length) throw badCredentials();
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    res.json({ user: me });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

const languageBody = z.object({ language: z.enum(LANGUAGES) });

/** Saves the signed-in user's interface language (the client sends it whenever it changes). */
authRouter.put('/language', requireAuth, validate(languageBody), async (req, res, next) => {
  try {
    const { language } = req.body as z.infer<typeof languageBody>;
    await User.updateOne({ _id: req.user!._id }, { $set: { language } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json(await buildMe(req.user!));
  } catch (e) {
    next(e);
  }
});
