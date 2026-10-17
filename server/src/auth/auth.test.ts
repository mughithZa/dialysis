import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { config } from '../config.js';
import { seedRoles } from './roles.seed.js';
import { Role } from './role.model.js';
import { effectivePermissions } from './effective.js';
import { requireAuth, requirePerm, requirePatient } from './middleware.js';
import { Centre } from '../centres/centre.model.js';
import { User } from './user.model.js';
import { createUser, login, getApp } from '../../test/factories.js';

beforeEach(seedRoles);

/** Test-only app sharing the session store/secret with createApp(), with probe routes guarded by the middleware. */
function buildProbe() {
  const app = express();
  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        client: mongoose.connection.getClient(),
        autoRemove: 'interval',
        autoRemoveInterval: 10,
      }),
    }),
  );
  app.post('/centres/:centreId/patients', requirePerm('patients.create'), (_q, r) => void r.json({ ok: true }));
  app.get('/global', requirePerm('centres.create'), (_q, r) => void r.json({ ok: true }));
  app.get('/auth-only', requireAuth, (_q, r) => void r.json({ ok: true }));
  app.get('/patient-only', requirePatient, (_q, r) => void r.json({ ok: true }));
  app.use(((err, _req, res, _next) => {
    res.status(err.status ?? 500).json({ error: err.code ?? 'internal' });
  }) as express.ErrorRequestHandler);
  return app;
}

const cookieOf = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');

/** Log in on the real app, return the session cookie to replay against the probe app. */
async function loginCookie(username: string): Promise<string> {
  const res = await request(getApp()).post('/api/auth/login').send({ username, password: 'pass1234' });
  expect(res.status).toBe(200);
  return cookieOf(res);
}

describe('auth routes', () => {
  it('logs in and returns permissions per centre', async () => {
    const c = await Centre.create({ name: 'C1' });
    await createUser({ username: 'fd', memberships: [{ centreId: c.id, roleKeys: ['front_desk'] }] });
    const res = await (await login('fd')).get('/api/auth/me');
    expect(res.body.centres[0].permissions).toContain('patients.create');
    expect(res.body.centres[0].name).toBe('C1');
  });

  it('union of two roles in one centre', async () => {
    const c = await Centre.create({ name: 'C1' });
    await createUser({ username: 'u', memberships: [{ centreId: c.id, roleKeys: ['centre_manager', 'front_desk'] }] });
    const res = await (await login('u')).get('/api/auth/me');
    expect(res.body.centres[0].permissions).toEqual(expect.arrayContaining(['audit.view', 'patients.create']));
  });

  it('wrong password → 401 bad_credentials', async () => {
    await createUser({ username: 'u', globalRoleKeys: ['program_manager'] });
    const res = await request(getApp()).post('/api/auth/login').send({ username: 'u', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'bad_credentials' });
  });

  it('inactive user and unknown user → 401 bad_credentials', async () => {
    const u = await createUser({ username: 'u', globalRoleKeys: ['program_manager'] });
    await User.updateOne({ _id: u._id }, { active: false });
    for (const username of ['u', 'ghost']) {
      const res = await request(getApp()).post('/api/auth/login').send({ username, password: 'pass1234' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'bad_credentials' });
    }
  });

  it('username is case-insensitive', async () => {
    await createUser({ username: 'MixedCase', globalRoleKeys: ['program_manager'] });
    const res = await request(getApp()).post('/api/auth/login').send({ username: 'MIXEDcase', password: 'pass1234' });
    expect(res.status).toBe(200);
  });

  it('only closed centres and no global role → 401; closed centres excluded from me', async () => {
    const open = await Centre.create({ name: 'Open' });
    const closed = await Centre.create({ name: 'Closed', status: 'closed' });
    await createUser({ username: 'onlyclosed', memberships: [{ centreId: closed.id, roleKeys: ['nurse'] }] });
    await createUser({
      username: 'both',
      memberships: [{ centreId: closed.id, roleKeys: ['nurse'] }, { centreId: open.id, roleKeys: ['nurse'] }],
    });
    await createUser({
      username: 'pm',
      globalRoleKeys: ['program_manager'],
      memberships: [{ centreId: closed.id, roleKeys: ['nurse'] }],
    });
    const r1 = await request(getApp()).post('/api/auth/login').send({ username: 'onlyclosed', password: 'pass1234' });
    expect(r1.status).toBe(401);
    expect(r1.body).toEqual({ error: 'bad_credentials' });
    const me = await (await login('both')).get('/api/auth/me');
    expect(me.body.centres.map((c: { name: string }) => c.name)).toEqual(['Open']);
    const pm = await (await login('pm')).get('/api/auth/me');
    expect(pm.body.centres).toEqual([]);
    expect(pm.body.globalPermissions).toContain('centres.create');
  });

  it('patient accounts can log in', async () => {
    await createUser({ username: 'pat', kind: 'patient' });
    const res = await (await login('pat')).get('/api/auth/me');
    expect(res.body).toMatchObject({ kind: 'patient', centres: [], globalPermissions: [] });
  });

  it('me without session → 401; logout destroys the session', async () => {
    expect((await request(getApp()).get('/api/auth/me')).status).toBe(401);
    await createUser({ username: 'u', globalRoleKeys: ['program_manager'] });
    const cookie = await loginCookie('u');
    expect((await request(getApp()).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
    expect((await request(getApp()).post('/api/auth/logout').set('Cookie', cookie)).status).toBe(200);
    // the old cookie must no longer be accepted (session destroyed server-side)
    expect((await request(getApp()).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('login regenerates the session id (old cookie is not kept)', async () => {
    await createUser({ username: 'u', globalRoleKeys: ['program_manager'] });
    const first = cookieOf(await request(getApp()).post('/api/auth/login').send({ username: 'u', password: 'pass1234' }));
    const again = await request(getApp())
      .post('/api/auth/login')
      .set('Cookie', first)
      .send({ username: 'u', password: 'pass1234' });
    expect(cookieOf(again)).not.toEqual(first);
    // the pre-login session id was destroyed by regenerate
    expect((await request(getApp()).get('/api/auth/me').set('Cookie', first)).status).toBe(401);
  });

  it('malformed JSON body → 400 validation', async () => {
    const res = await request(getApp())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'validation' });
  });

  it('missing fields → 400 validation', async () => {
    const res = await request(getApp()).post('/api/auth/login').send({ username: 'u' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation');
  });
});

describe('middleware', () => {
  it('requirePerm: nurse cannot create patient → 403; front desk can', async () => {
    const c = await Centre.create({ name: 'C1' });
    await createUser({ username: 'n', memberships: [{ centreId: c.id, roleKeys: ['nurse'] }] });
    await createUser({ username: 'fd', memberships: [{ centreId: c.id, roleKeys: ['front_desk'] }] });
    const app = buildProbe();
    const n = await request(app).post(`/centres/${c.id}/patients`).set('Cookie', await loginCookie('n'));
    expect(n.status).toBe(403);
    expect(n.body).toEqual({ error: 'forbidden' });
    const fd = await request(app).post(`/centres/${c.id}/patients`).set('Cookie', await loginCookie('fd'));
    expect(fd.status).toBe(200);
  });

  it('requirePerm: member of A calling centre B → 403', async () => {
    const a = await Centre.create({ name: 'A' });
    const b = await Centre.create({ name: 'B' });
    await createUser({ username: 'fd', memberships: [{ centreId: a.id, roleKeys: ['front_desk'] }] });
    const res = await request(buildProbe()).post(`/centres/${b.id}/patients`).set('Cookie', await loginCookie('fd'));
    expect(res.status).toBe(403);
  });

  it('requirePerm: unauthenticated → 401; malformed centre id → 403', async () => {
    const c = await Centre.create({ name: 'C' });
    const app = buildProbe();
    expect((await request(app).post(`/centres/${c.id}/patients`)).status).toBe(401);
    await createUser({ username: 'fd', memberships: [{ centreId: c.id, roleKeys: ['front_desk'] }] });
    expect((await request(app).post('/centres/xyz/patients').set('Cookie', await loginCookie('fd'))).status).toBe(403);
  });

  it('requirePerm: closed centre → 404 for a member holding the permission', async () => {
    const open = await Centre.create({ name: 'Open' });
    const c = await Centre.create({ name: 'C' });
    await createUser({
      username: 'fd',
      memberships: [{ centreId: c.id, roleKeys: ['front_desk'] }, { centreId: open.id, roleKeys: ['front_desk'] }],
    });
    const cookie = await loginCookie('fd');
    await Centre.updateOne({ _id: c._id }, { status: 'closed' });
    const res = await request(buildProbe()).post(`/centres/${c.id}/patients`).set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('requirePerm: global permission needs no centre; a centre role does not grant it', async () => {
    const c = await Centre.create({ name: 'C' });
    await createUser({ username: 'pm', globalRoleKeys: ['program_manager'] });
    await createUser({ username: 'fd', memberships: [{ centreId: c.id, roleKeys: ['front_desk'] }] });
    const app = buildProbe();
    expect((await request(app).get('/global').set('Cookie', await loginCookie('pm'))).status).toBe(200);
    expect((await request(app).get('/global').set('Cookie', await loginCookie('fd'))).status).toBe(403);
  });

  it('requirePatient: patient passes, staff gets 403, anonymous 401', async () => {
    await createUser({ username: 'pat', kind: 'patient' });
    await createUser({ username: 'st', globalRoleKeys: ['program_manager'] });
    const app = buildProbe();
    expect((await request(app).get('/patient-only')).status).toBe(401);
    expect((await request(app).get('/patient-only').set('Cookie', await loginCookie('pat'))).status).toBe(200);
    expect((await request(app).get('/patient-only').set('Cookie', await loginCookie('st'))).status).toBe(403);
  });

  it('deactivated user with a live session → 401', async () => {
    const u = await createUser({ username: 'st', globalRoleKeys: ['program_manager'] });
    const cookie = await loginCookie('st');
    await User.updateOne({ _id: u._id }, { active: false });
    expect((await request(buildProbe()).get('/auth-only').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('effectivePermissions', () => {
  const idOf = async (key: string) => (await Role.findOne({ key }))!._id;
  const centreId = new Types.ObjectId();

  it('global-only roles, no centre', async () => {
    const perms = await effectivePermissions(
      { globalRoleIds: [await idOf('program_manager')], memberships: [] },
      null,
    );
    expect(perms.has('centres.create')).toBe(true);
    expect(perms.has('patients.create')).toBe(false);
  });

  it('centre membership grants centre permissions', async () => {
    const perms = await effectivePermissions(
      { globalRoleIds: [], memberships: [{ centreId, roleIds: [await idOf('nurse')] }] },
      centreId.toString(),
    );
    expect(perms.has('sessions.run')).toBe(true);
    expect(perms.has('patients.create')).toBe(false);
  });

  it('union of two roles', async () => {
    const perms = await effectivePermissions(
      { globalRoleIds: [], memberships: [{ centreId, roleIds: [await idOf('nurse'), await idOf('front_desk')] }] },
      centreId.toString(),
    );
    expect(perms.has('sessions.run')).toBe(true);
    expect(perms.has('patients.create')).toBe(true);
  });

  it('no membership in that centre → empty set', async () => {
    const perms = await effectivePermissions(
      { globalRoleIds: [], memberships: [{ centreId, roleIds: [await idOf('nurse')] }] },
      new Types.ObjectId().toString(),
    );
    expect(perms.size).toBe(0);
  });

  it('ignores global-scope roles inside a centre membership', async () => {
    const perms = await effectivePermissions(
      {
        globalRoleIds: [],
        memberships: [{ centreId, roleIds: [await idOf('program_manager'), await idOf('nurse')] }],
      },
      centreId.toString(),
    );
    expect(perms.has('centres.create')).toBe(false);
    expect(perms.has('sessions.run')).toBe(true);
  });
});
