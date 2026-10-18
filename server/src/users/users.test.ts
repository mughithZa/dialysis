import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { seedRoles } from '../auth/roles.seed.js';
import { User } from '../auth/user.model.js';
import { Role } from '../auth/role.model.js';
import { AuditEntry } from '../audit/audit.model.js';
import { createUser, getApp, login, makeCentre, makePatient, programManager, staffIn } from '../../test/factories.js';

beforeEach(seedRoles);

const body = (o: object = {}) => ({ username: 'newbie', password: 'secret123', name: 'New', roleKeys: ['nurse'], ...o });

describe('centre users', () => {
  it('front desk creates a nurse, a doctor and a front desk user; the nurse logs in with that role', async () => {
    const { centre } = await makeCentre();
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const res = await agent.post(`/api/centres/${centre.id}/users`).send(body({ phone: '0911' }));
    expect(res.status).toBe(201);
    expect((await agent.post(`/api/centres/${centre.id}/users`).send(body({ username: 'doc', roleKeys: ['doctor'] }))).status).toBe(201);
    expect((await agent.post(`/api/centres/${centre.id}/users`).send(body({ username: 'fd2', roleKeys: ['front_desk'] }))).status).toBe(201);
    const nurse = await login('newbie', 'secret123');
    const me = await nurse.get('/api/auth/me');
    expect(me.body.centres[0].permissions).toContain('sessions.run');
    expect(await AuditEntry.countDocuments({ action: 'user.create' })).toBe(3);
  });

  it('front desk cannot create a centre_manager or program_manager; nothing is created', async () => {
    const { centre } = await makeCentre();
    const { agent } = await staffIn(centre.id, ['front_desk']);
    for (const key of ['centre_manager', 'program_manager']) {
      const res = await agent.post(`/api/centres/${centre.id}/users`).send(body({ roleKeys: [key] }));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('cannot_grant');
    }
    expect(await User.countDocuments({ username: 'newbie' })).toBe(0);
  });

  it('nobody can grant program_manager via centre routes, even a centre manager', async () => {
    const { centre } = await makeCentre();
    const { agent } = await staffIn(centre.id, ['centre_manager']);
    const res = await agent.post(`/api/centres/${centre.id}/users`).send(body({ roleKeys: ['program_manager'] }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('cannot_grant');
  });

  it('validation, unknown role, duplicate username', async () => {
    const { centre } = await makeCentre();
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const url = `/api/centres/${centre.id}/users`;
    expect((await agent.post(url).send(body({ password: 'short' }))).status).toBe(400);
    expect((await agent.post(url).send(body({ roleKeys: [] }))).status).toBe(400);
    expect((await agent.post(url).send(body({ roleKeys: ['nope'] }))).status).toBe(400);
    await agent.post(url).send(body());
    const dup = await agent.post(url).send(body());
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('username_taken');
  });

  it('lists staff of this centre only; nurse cannot list', async () => {
    const a = await makeCentre({ name: 'A' });
    const b = await makeCentre({ name: 'B' });
    const mgr = await staffIn(a.centre.id, ['centre_manager'], 'mgr');
    await staffIn(b.centre.id, ['nurse'], 'other');
    const res = await mgr.agent.get(`/api/centres/${a.centre.id}/users`);
    expect(res.status).toBe(200);
    expect(res.body.map((u: { username: string }) => u.username)).toEqual(['mgr']);
    expect(res.body[0].roleKeys).toEqual(['centre_manager']);
    const nurse = await staffIn(a.centre.id, ['nurse']);
    expect((await nurse.agent.get(`/api/centres/${a.centre.id}/users`)).status).toBe(403);
  });

  it('centre manager edits name, changes roles and deactivates', async () => {
    const { centre } = await makeCentre();
    const mgr = await staffIn(centre.id, ['centre_manager']);
    const nurse = await staffIn(centre.id, ['nurse']);
    const url = `/api/centres/${centre.id}/users/${nurse.user.id}`;
    const res = await mgr.agent.patch(url).send({ name: 'Renamed', roleKeys: ['nurse', 'doctor'] });
    expect(res.status).toBe(200);
    const me = await nurse.agent.get('/api/auth/me');
    expect(me.body.centres[0].permissions).toContain('orders.write');
    expect((await mgr.agent.patch(url).send({ active: false })).status).toBe(200);
    expect((await nurse.agent.get('/api/auth/me')).status).toBe(401);
    expect(await AuditEntry.countDocuments({ action: 'user.edit' })).toBe(2);
  });

  it('role changes need roles.assign and are bounded by the grant rule', async () => {
    const { centre } = await makeCentre();
    const fdUser = await staffIn(centre.id, ['front_desk'], 'fd');
    const nurse = await staffIn(centre.id, ['nurse']);
    const url = `/api/centres/${centre.id}/users/${nurse.user.id}`;
    // front desk lacks users.edit entirely
    expect((await fdUser.agent.patch(url).send({ name: 'x' })).status).toBe(403);
    // a role with users.edit but not roles.assign
    await Role.create({ key: 'editor', name: 'Editor', scope: 'centre', permissions: ['users.edit'] });
    const ed = await createUser({ username: 'ed', memberships: [{ centreId: centre.id, roleKeys: ['editor'] }] });
    const edAgent = await login(ed.username);
    expect((await edAgent.patch(url).send({ name: 'ok' })).status).toBe(200);
    expect((await edAgent.patch(url).send({ roleKeys: ['doctor'] })).status).toBe(403);
    // a manager still cannot hand out program_manager
    const mgr = await staffIn(centre.id, ['centre_manager']);
    const res = await mgr.agent.patch(url).send({ roleKeys: ['program_manager'] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('cannot_grant');
  });

  it('centre manager assigns front_desk to themself and gets the union', async () => {
    const { centre } = await makeCentre();
    const mgr = await staffIn(centre.id, ['centre_manager']);
    const res = await mgr.agent
      .patch(`/api/centres/${centre.id}/users/${mgr.user.id}`)
      .send({ roleKeys: ['centre_manager', 'front_desk'] });
    expect(res.status).toBe(200);
    const perms = (await mgr.agent.get('/api/auth/me')).body.centres[0].permissions;
    expect(perms).toContain('settings.centre');
    expect(perms).toContain('patients.create');
  });

  it('users of another centre are 404', async () => {
    const a = await makeCentre();
    const b = await makeCentre();
    const mgr = await staffIn(a.centre.id, ['centre_manager']);
    const other = await staffIn(b.centre.id, ['nurse']);
    expect((await mgr.agent.patch(`/api/centres/${a.centre.id}/users/${other.user.id}`).send({ name: 'x' })).status).toBe(404);
    expect((await mgr.agent.patch(`/api/centres/${a.centre.id}/users/nonsense`).send({ name: 'x' })).status).toBe(404);
  });

  it('reset password works inside the centre, 404 for another centre, 400 when short', async () => {
    const a = await makeCentre();
    const b = await makeCentre();
    const fd = await staffIn(a.centre.id, ['front_desk']);
    const nurse = await staffIn(a.centre.id, ['nurse'], 'nursey');
    const other = await staffIn(b.centre.id, ['nurse']);
    const ok = await fd.agent.post(`/api/centres/${a.centre.id}/users/${nurse.user.id}/reset-password`).send({ password: 'brandnew1' });
    expect(ok.status).toBe(200);
    await login('nursey', 'brandnew1');
    expect((await fd.agent.post(`/api/centres/${a.centre.id}/users/${other.user.id}/reset-password`).send({ password: 'brandnew1' })).status).toBe(404);
    expect((await fd.agent.post(`/api/centres/${a.centre.id}/users/${nurse.user.id}/reset-password`).send({ password: 'x' })).status).toBe(400);
    expect(await AuditEntry.countDocuments({ action: 'user.resetPassword' })).toBe(1);
  });

  it('reset password also works for a patient of this centre; another centre is 404', async () => {
    const a = await makeCentre();
    const b = await makeCentre();
    const fd = await staffIn(a.centre.id, ['front_desk']);
    const mine = await makePatient(a.centre.id, { username: 'mypat' });
    const theirs = await makePatient(b.centre.id);
    const ok = await fd.agent.post(`/api/centres/${a.centre.id}/users/${mine.user.id}/reset-password`).send({ password: 'brandnew1' });
    expect(ok.status).toBe(200);
    await login('mypat', 'brandnew1');
    expect((await fd.agent.post(`/api/centres/${a.centre.id}/users/${theirs.user.id}/reset-password`).send({ password: 'brandnew1' })).status).toBe(404);
  });

  it('front desk cannot reset a centre manager password; manager can reset front desk', async () => {
    const { centre } = await makeCentre();
    const fd = await staffIn(centre.id, ['front_desk'], 'fdesk');
    const mgr = await staffIn(centre.id, ['centre_manager'], 'themgr');
    const denied = await fd.agent.post(`/api/centres/${centre.id}/users/${mgr.user.id}/reset-password`).send({ password: 'hijacked1' });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('cannot_grant');
    await login('themgr');
    const ok = await mgr.agent.post(`/api/centres/${centre.id}/users/${fd.user.id}/reset-password`).send({ password: 'brandnew1' });
    expect(ok.status).toBe(200);
    await login('fdesk', 'brandnew1');
  });

  it('lookup by phone + link puts a doctor in two centres', async () => {
    const a = await makeCentre({ name: 'A' });
    const b = await makeCentre({ name: 'B' });
    const doc = await createUser({ username: 'drx', memberships: [{ centreId: a.centre.id, roleKeys: ['doctor'] }] });
    await User.updateOne({ _id: doc._id }, { phone: '0955' });
    const fdB = await staffIn(b.centre.id, ['front_desk']);
    const found = await fdB.agent.get(`/api/centres/${b.centre.id}/users/lookup`).query({ phone: '0955' });
    expect(found.status).toBe(200);
    expect(found.body).toEqual([{ id: doc.id, name: 'drx' }]);
    expect((await fdB.agent.get(`/api/centres/${b.centre.id}/users/lookup`).query({ phone: '0000' })).body).toEqual([]);
    expect((await fdB.agent.get(`/api/centres/${b.centre.id}/users/lookup`)).status).toBe(400);
    const link = await fdB.agent.post(`/api/centres/${b.centre.id}/users/${doc.id}/link`).send({ roleKeys: ['doctor'] });
    expect(link.status).toBe(200);
    const me = await (await login('drx')).get('/api/auth/me');
    expect(me.body.centres.map((c: { name: string }) => c.name).sort()).toEqual(['A', 'B']);
    expect((await fdB.agent.post(`/api/centres/${b.centre.id}/users/${doc.id}/link`).send({ roleKeys: ['doctor'] })).status).toBe(409);
    expect(await AuditEntry.countDocuments({ action: 'user.link' })).toBe(1);
  });

  it('link is bounded by the grant rule', async () => {
    const a = await makeCentre();
    const b = await makeCentre();
    const doc = await createUser({ username: 'dry', memberships: [{ centreId: a.centre.id, roleKeys: ['doctor'] }] });
    const fdB = await staffIn(b.centre.id, ['front_desk']);
    const res = await fdB.agent.post(`/api/centres/${b.centre.id}/users/${doc.id}/link`).send({ roleKeys: ['centre_manager'] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('cannot_grant');
  });

  it('lookup excludes patients and users with global roles; link refuses them', async () => {
    const { centre } = await makeCentre();
    const fd = await staffIn(centre.id, ['front_desk']);
    const pm = await createUser({ username: 'pmx', globalRoleKeys: ['program_manager'] });
    const pt = await createUser({ username: 'pt', kind: 'patient' });
    await User.updateMany({ _id: { $in: [pm._id, pt._id] } }, { phone: '0966' });
    const res = await fd.agent.get(`/api/centres/${centre.id}/users/lookup`).query({ phone: '0966' });
    expect(res.body).toEqual([]);
    expect((await fd.agent.post(`/api/centres/${centre.id}/users/${pt.id}/link`).send({ roleKeys: ['nurse'] })).status).toBe(404);
    expect((await fd.agent.post(`/api/centres/${centre.id}/users/${pm.id}/link`).send({ roleKeys: ['nurse'] })).status).toBe(404);
  });

  it('cross-centre takeover: front desk B links A\'s manager, then reset is refused', async () => {
    const a = await makeCentre({ name: 'A' });
    const b = await makeCentre({ name: 'B' });
    const mgrA = await staffIn(a.centre.id, ['centre_manager'], 'mgra');
    await User.updateOne({ _id: mgrA.user._id }, { phone: '0977' });
    const fdB = await staffIn(b.centre.id, ['front_desk']);
    const found = await fdB.agent.get(`/api/centres/${b.centre.id}/users/lookup`).query({ phone: '0977' });
    expect(found.body).toEqual([{ id: mgrA.user.id, name: 'mgra' }]);
    expect((await fdB.agent.post(`/api/centres/${b.centre.id}/users/${mgrA.user.id}/link`).send({ roleKeys: ['doctor'] })).status).toBe(200);
    const res = await fdB.agent.post(`/api/centres/${b.centre.id}/users/${mgrA.user.id}/reset-password`).send({ password: 'hijacked1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_home_centre');
    await login('mgra');
  });

  it('privileged check spans every membership of the target', async () => {
    const a = await makeCentre({ name: 'A' });
    const b = await makeCentre({ name: 'B' });
    // home centre B (plain doctor there), but manager in A
    const target = await createUser({
      username: 'dual',
      memberships: [
        { centreId: b.centre.id, roleKeys: ['doctor'] },
        { centreId: a.centre.id, roleKeys: ['centre_manager'] },
      ],
    });
    const fdB = await staffIn(b.centre.id, ['front_desk']);
    const res = await fdB.agent.post(`/api/centres/${b.centre.id}/users/${target.id}/reset-password`).send({ password: 'hijacked1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('cannot_grant');
  });

  it('home centre manager resets its own linked front desk; the old session is logged out', async () => {
    const a = await makeCentre({ name: 'A' });
    const b = await makeCentre({ name: 'B' });
    const mgrA = await staffIn(a.centre.id, ['centre_manager']);
    const fdA = await staffIn(a.centre.id, ['front_desk'], 'fdhome');
    const mgrB = await staffIn(b.centre.id, ['centre_manager']);
    expect((await mgrB.agent.post(`/api/centres/${b.centre.id}/users/${fdA.user.id}/link`).send({ roleKeys: ['nurse'] })).status).toBe(200);
    expect((await fdA.agent.get('/api/auth/me')).status).toBe(200);
    const ok = await mgrA.agent.post(`/api/centres/${a.centre.id}/users/${fdA.user.id}/reset-password`).send({ password: 'brandnew1' });
    expect(ok.status).toBe(200);
    expect((await fdA.agent.get('/api/auth/me')).status).toBe(401);
    expect((await mgrA.agent.get('/api/auth/me')).status).toBe(200);
    await login('fdhome', 'brandnew1');
  });

  it('deactivation logs the user out at once (session removed from the store)', async () => {
    const { centre } = await makeCentre();
    const mgr = await staffIn(centre.id, ['centre_manager']);
    const nurse = await staffIn(centre.id, ['nurse']);
    const sessions = mongoose.connection.collection('sessions');
    const count = () => sessions.countDocuments({ session: { $regex: `"userId":"${nurse.user.id}"` } });
    expect(await count()).toBe(1);
    expect((await mgr.agent.patch(`/api/centres/${centre.id}/users/${nurse.user.id}`).send({ active: false })).status).toBe(200);
    expect(await count()).toBe(0);
  });

  it('shared user: a non-home centre cannot change name/phone and "deactivate" only unlinks', async () => {
    const a = await makeCentre({ name: 'A' });
    const b = await makeCentre({ name: 'B' });
    const doc = await createUser({ username: 'shared', memberships: [{ centreId: a.centre.id, roleKeys: ['doctor'] }] });
    const mgrB = await staffIn(b.centre.id, ['centre_manager']);
    const mgrA = await staffIn(a.centre.id, ['centre_manager']);
    expect((await mgrB.agent.post(`/api/centres/${b.centre.id}/users/${doc.id}/link`).send({ roleKeys: ['doctor'] })).status).toBe(200);
    const url = `/api/centres/${b.centre.id}/users/${doc.id}`;
    for (const change of [{ name: 'Other' }, { phone: '0999' }]) {
      const res = await mgrB.agent.patch(url).send(change);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('not_home_centre');
    }
    // sending the unchanged name is fine (forms send every field)
    expect((await mgrB.agent.patch(url).send({ name: 'shared', roleKeys: ['doctor', 'nurse'] })).status).toBe(200);
    expect((await mgrB.agent.patch(url).send({ active: false })).status).toBe(200);
    const after = await User.findById(doc._id);
    expect(after!.active).toBe(true);
    expect(after!.memberships.map((m) => String(m.centreId))).toEqual([a.centre.id]);
    expect((await mgrB.agent.get(`/api/centres/${b.centre.id}/users`)).body.map((u: { id: string }) => u.id)).not.toContain(doc.id);
    const me = await (await login('shared')).get('/api/auth/me');
    expect(me.body.centres.map((c: { name: string }) => c.name)).toEqual(['A']);
    // the home centre can still rename
    expect((await mgrA.agent.patch(`/api/centres/${a.centre.id}/users/${doc.id}`).send({ name: 'Renamed' })).status).toBe(200);
  });

  it('refuses self-deactivation', async () => {
    const { centre } = await makeCentre();
    const mgr = await staffIn(centre.id, ['centre_manager']);
    const res = await mgr.agent.patch(`/api/centres/${centre.id}/users/${mgr.user.id}`).send({ active: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cannot_deactivate_self');
    expect((await mgr.agent.get('/api/auth/me')).status).toBe(200);
  });

  it('requires auth and permission', async () => {
    const { centre } = await makeCentre();
    expect((await request(getApp()).get(`/api/centres/${centre.id}/users`)).status).toBe(401);
    const { agent } = await programManager();
    expect((await agent.post(`/api/centres/${centre.id}/users`).send(body())).status).toBe(403);
  });
});
