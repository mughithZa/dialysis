import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { seedRoles } from '../auth/roles.seed.js';
import { User } from '../auth/user.model.js';
import { AuditEntry } from '../audit/audit.model.js';
import { createUser, getApp, login, makeCentre, programManager, staffIn } from '../../test/factories.js';

beforeEach(seedRoles);

const newCentre = (name = 'North', username = 'northmgr') => ({
  name,
  manager: { username, password: 'secret123', name: 'North Manager', phone: '0999' },
});

describe('centres (program manager)', () => {
  it('creates a centre with a manager who can log in and sees it in /auth/me', async () => {
    const { agent } = await programManager();
    const res = await agent.post('/api/centres').send(newCentre());
    expect(res.status).toBe(201);
    expect(res.body.centre).toMatchObject({ name: 'North', status: 'active' });
    const mgr = request.agent(getApp());
    const l = await mgr.post('/api/auth/login').send({ username: 'northmgr', password: 'secret123' });
    expect(l.status).toBe(200);
    const me = await mgr.get('/api/auth/me');
    expect(me.body.centres.map((c: { id: string }) => c.id)).toEqual([res.body.centre.id]);
    expect(me.body.centres[0].permissions).toContain('settings.centre');
    expect((await User.findOne({ username: 'northmgr' }))!.id).toBe(res.body.managerId);
    expect(await AuditEntry.countDocuments({ action: 'centre.create' })).toBe(1);
  });

  it('409 username_taken, and nothing is created', async () => {
    const { agent } = await programManager();
    await createUser({ username: 'northmgr' });
    const res = await agent.post('/api/centres').send(newCentre());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('username_taken');
    expect((await agent.get('/api/centres')).body).toHaveLength(0);
  });

  it('validates the create body', async () => {
    const { agent } = await programManager();
    expect((await agent.post('/api/centres').send({ name: '' })).status).toBe(400);
  });

  it('front desk cannot create a centre', async () => {
    const { centre } = await makeCentre();
    const { agent } = await staffIn(centre.id, ['front_desk']);
    expect((await agent.post('/api/centres').send(newCentre())).status).toBe(403);
  });

  it('lists all centres for PM and own centres for staff', async () => {
    const a = await makeCentre({ name: 'A' });
    await makeCentre({ name: 'B' });
    const pm = await programManager();
    const all = await pm.agent.get('/api/centres');
    expect(all.body.map((c: { name: string }) => c.name).sort()).toEqual(['A', 'B']);
    expect(all.body[0]).toHaveProperty('status');
    const { agent } = await staffIn(a.centre.id, ['nurse']);
    const own = await agent.get('/api/centres');
    expect(own.body.map((c: { name: string }) => c.name)).toEqual(['A']);
    const nobody = await createUser({ username: 'nobody' });
    expect((await (await login(nobody.username)).get('/api/centres')).status).toBe(403);
  });

  it('close hides the centre from members; reopen restores; PM can still reach closed centre', async () => {
    const { centre } = await makeCentre();
    const { agent: mgr, user } = await staffIn(centre.id, ['centre_manager'], 'only');
    const pm = await programManager();
    expect((await pm.agent.post(`/api/centres/${centre.id}/close`)).status).toBe(200);
    expect((await mgr.get(`/api/centres/${centre.id}/settings`)).status).toBe(404);
    const relogin = await request(getApp()).post('/api/auth/login').send({ username: user.username, password: 'pass1234' });
    expect(relogin.status).toBe(401);
    expect((await pm.agent.get(`/api/centres/${centre.id}/managers`)).status).toBe(200);
    expect((await pm.agent.get('/api/centres')).body[0].status).toBe('closed');
    expect((await pm.agent.post(`/api/centres/${centre.id}/reopen`)).status).toBe(200);
    expect((await mgr.get(`/api/centres/${centre.id}/settings`)).status).toBe(200);
    expect((await login(user.username)).get).toBeTypeOf('function');
    expect(await AuditEntry.countDocuments({ action: { $in: ['centre.close', 'centre.reopen'] } })).toBe(2);
  });

  it('a doctor in A and B keeps B when A closes', async () => {
    const a = await makeCentre({ name: 'A' });
    const b = await makeCentre({ name: 'B' });
    const doc = await createUser({
      username: 'doc',
      memberships: [
        { centreId: a.centre.id, roleKeys: ['doctor'] },
        { centreId: b.centre.id, roleKeys: ['doctor'] },
      ],
    });
    const pm = await programManager();
    await pm.agent.post(`/api/centres/${a.centre.id}/close`);
    const agent = await login(doc.username);
    const me = await agent.get('/api/auth/me');
    expect(me.body.centres.map((c: { name: string }) => c.name)).toEqual(['B']);
  });

  it('404 for unknown centre on close/reopen/managers', async () => {
    const pm = await programManager();
    const id = '64b000000000000000000000';
    expect((await pm.agent.post(`/api/centres/${id}/close`)).status).toBe(404);
    expect((await pm.agent.post(`/api/centres/${id}/reopen`)).status).toBe(404);
    expect((await pm.agent.get(`/api/centres/${id}/managers`)).status).toBe(404);
  });

  it('PM resets a manager password but gets 404 for a nurse', async () => {
    const { centre } = await makeCentre();
    const mgr = await staffIn(centre.id, ['centre_manager'], 'mgr1');
    const nurse = await staffIn(centre.id, ['nurse'], 'nurse1');
    const pm = await programManager();
    const list = await pm.agent.get(`/api/centres/${centre.id}/managers`);
    expect(list.body).toEqual([expect.objectContaining({ id: mgr.user.id, username: 'mgr1' })]);
    const reset = `/api/centres/${centre.id}/managers/${mgr.user.id}/reset-password`;
    expect((await pm.agent.post(reset).send({ password: 'newpass99' })).status).toBe(200);
    expect((await request(getApp()).post('/api/auth/login').send({ username: 'mgr1', password: 'newpass99' })).status).toBe(200);
    expect((await request(getApp()).post('/api/auth/login').send({ username: 'mgr1', password: 'pass1234' })).status).toBe(401);
    const bad = await pm.agent.post(`/api/centres/${centre.id}/managers/${nurse.user.id}/reset-password`).send({ password: 'newpass99' });
    expect(bad.status).toBe(404);
    expect((await pm.agent.post(reset).send({ password: 'x' })).status).toBe(400);
  });
});

describe('centre settings', () => {
  it('reads defaults, updates, and validates', async () => {
    const { centre } = await makeCentre();
    const { agent } = await staffIn(centre.id, ['centre_manager']);
    const got = await agent.get(`/api/centres/${centre.id}/settings`);
    expect(got.body).toEqual({ patientsSeeNotes: false, reminderHours: 24 });
    const up = await agent.patch(`/api/centres/${centre.id}/settings`).send({ patientsSeeNotes: true, reminderHours: 48 });
    expect(up.status).toBe(200);
    expect(up.body).toEqual({ patientsSeeNotes: true, reminderHours: 48 });
    expect((await agent.get(`/api/centres/${centre.id}/settings`)).body.reminderHours).toBe(48);
    for (const body of [{ reminderHours: 0 }, { reminderHours: 73 }, { reminderHours: 1.5 }, { patientsSeeNotes: 'yes' }]) {
      expect((await agent.patch(`/api/centres/${centre.id}/settings`).send(body)).status).toBe(400);
    }
    expect(await AuditEntry.countDocuments({ action: 'settings.update' })).toBe(1);
  });

  it('nurse cannot read settings; other centre manager gets 403', async () => {
    const a = await makeCentre();
    const b = await makeCentre({ name: 'B' });
    const nurse = await staffIn(a.centre.id, ['nurse']);
    expect((await nurse.agent.get(`/api/centres/${a.centre.id}/settings`)).status).toBe(403);
    const other = await staffIn(b.centre.id, ['centre_manager']);
    expect((await other.agent.patch(`/api/centres/${a.centre.id}/settings`).send({ reminderHours: 5 })).status).toBe(403);
  });
});

describe('chairs and shifts', () => {
  it('chairs CRUD, unique label, centre scoping', async () => {
    const a = await makeCentre({ chairs: 2 });
    const b = await makeCentre({ name: 'B', chairs: 1 });
    const { agent } = await staffIn(a.centre.id, ['centre_manager']);
    const base = `/api/centres/${a.centre.id}/chairs`;
    const list = await agent.get(base);
    expect(list.body.map((c: { label: string }) => c.label)).toEqual(['1', '2']);
    const created = await agent.post(base).send({ label: '3' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ label: '3', active: true });
    expect((await agent.post(base).send({ label: '3' })).status).toBe(409);
    expect((await agent.post(base).send({ label: '' })).status).toBe(400);
    const upd = await agent.patch(`${base}/${created.body.id}`).send({ active: false });
    expect(upd.body.active).toBe(false);
    expect((await agent.patch(`${base}/${created.body.id}`).send({ label: '1' })).status).toBe(409);
    expect((await agent.patch(`${base}/${b.chairs[0]!.id}`).send({ active: false })).status).toBe(404);
    expect((await agent.patch(`${base}/nope`).send({ active: false })).status).toBe(404);
    expect(await AuditEntry.countDocuments({ action: { $in: ['chair.create', 'chair.update'] } })).toBe(2);
  });

  it('shifts CRUD and start < end', async () => {
    const a = await makeCentre();
    const { agent } = await staffIn(a.centre.id, ['centre_manager']);
    const base = `/api/centres/${a.centre.id}/shifts`;
    const list = await agent.get(base);
    expect(list.body.map((s: { name: string }) => s.name)).toEqual(['Morning', 'Afternoon']);
    const created = await agent.post(base).send({ name: 'Evening', start: '17:00', end: '21:00' });
    expect(created.status).toBe(201);
    expect((await agent.post(base).send({ name: 'Bad', start: '11:00', end: '11:00' })).status).toBe(400);
    expect((await agent.post(base).send({ name: 'Bad', start: '12:00', end: '11:00' })).status).toBe(400);
    expect((await agent.post(base).send({ name: 'Bad', start: '7:00', end: '11:00' })).status).toBe(400);
    const upd = await agent.patch(`${base}/${created.body.id}`).send({ end: '22:00', active: false });
    expect(upd.body).toMatchObject({ start: '17:00', end: '22:00', active: false });
    expect((await agent.patch(`${base}/${created.body.id}`).send({ start: '23:00' })).status).toBe(400);
    expect(await AuditEntry.countDocuments({ action: { $in: ['shift.create', 'shift.update'] } })).toBe(2);
  });

  it('nurse can read but not write; doctor cannot read', async () => {
    const a = await makeCentre();
    const nurse = await staffIn(a.centre.id, ['nurse']);
    expect((await nurse.agent.get(`/api/centres/${a.centre.id}/chairs`)).status).toBe(200);
    expect((await nurse.agent.post(`/api/centres/${a.centre.id}/chairs`).send({ label: 'x' })).status).toBe(403);
    expect((await nurse.agent.post(`/api/centres/${a.centre.id}/shifts`).send({ name: 'x', start: '01:00', end: '02:00' })).status).toBe(403);
    const doc = await staffIn(a.centre.id, ['doctor']);
    expect((await doc.agent.get(`/api/centres/${a.centre.id}/shifts`)).status).toBe(403);
  });
});
