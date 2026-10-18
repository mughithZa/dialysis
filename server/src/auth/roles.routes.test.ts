import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { seedRoles } from './roles.seed.js';
import { Role } from './role.model.js';
import { AuditEntry } from '../audit/audit.model.js';
import { getApp, makeCentre, programManager, staffIn } from '../../test/factories.js';

beforeEach(seedRoles);

describe('roles', () => {
  it('any staff lists roles and the permission catalogue', async () => {
    const { centre } = await makeCentre();
    const { agent } = await staffIn(centre.id, ['nurse']);
    const roles = await agent.get('/api/roles');
    expect(roles.status).toBe(200);
    expect(roles.body.map((r: { key: string }) => r.key)).toContain('front_desk');
    const perms = await agent.get('/api/permissions');
    expect(perms.status).toBe(200);
    expect(perms.body).toContainEqual({ key: 'sessions.run', category: 'Sessions' });
  });

  it('requires login', async () => {
    expect((await request(getApp()).get('/api/roles')).status).toBe(401);
  });

  it('PM adds a permission to front_desk and a front-desk user then has it in /auth/me', async () => {
    const { centre } = await makeCentre();
    const fd = await staffIn(centre.id, ['front_desk']);
    const before = await fd.agent.get('/api/auth/me');
    expect(before.body.centres[0].permissions).not.toContain('sessions.editClosed');
    const { agent: pm } = await programManager();
    const role = await Role.findOne({ key: 'front_desk' });
    const res = await pm.patch(`/api/roles/${role!.id}`).send({ permissions: [...role!.permissions, 'sessions.editClosed'] });
    expect(res.status).toBe(200);
    const after = await fd.agent.get('/api/auth/me');
    expect(after.body.centres[0].permissions).toContain('sessions.editClosed');
    expect(await AuditEntry.countDocuments({ action: 'role.edit' })).toBe(1);
  });

  it('program_manager cannot be edited', async () => {
    const { agent: pm } = await programManager();
    const role = await Role.findOne({ key: 'program_manager' });
    const res = await pm.patch(`/api/roles/${role!.id}`).send({ name: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('system_role_locked');
  });

  it('a centre manager cannot edit roles (roles.edit is global)', async () => {
    const { centre } = await makeCentre();
    const { agent } = await staffIn(centre.id, ['centre_manager']);
    const role = await Role.findOne({ key: 'nurse' });
    expect((await agent.patch(`/api/roles/${role!.id}`).send({ name: 'x' })).status).toBe(403);
    expect((await agent.post('/api/roles').send({ name: 'x', permissions: [] })).status).toBe(403);
  });

  it('PM creates a centre-scope role; global permissions and unknown ids are rejected', async () => {
    const { agent: pm } = await programManager();
    const ok = await pm.post('/api/roles').send({ name: 'Viewer', permissions: ['patients.view'] });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ name: 'Viewer', scope: 'centre', permissions: ['patients.view'] });
    expect(await AuditEntry.countDocuments({ action: 'role.create' })).toBe(1);
    const bad = await pm.post('/api/roles').send({ name: 'Bad', permissions: ['centres.create'] });
    expect(bad.status).toBe(400);
    const nurse = await Role.findOne({ key: 'nurse' });
    expect((await pm.patch(`/api/roles/${nurse!.id}`).send({ permissions: ['stats.global'] })).status).toBe(400);
    expect((await pm.post('/api/roles').send({ name: 'Bad', permissions: ['nope'] })).status).toBe(400);
    expect((await pm.patch('/api/roles/zzz').send({ name: 'x' })).status).toBe(404);
  });
});
