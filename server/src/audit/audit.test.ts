import { describe, it, expect, beforeEach } from 'vitest';
import type { Request } from 'express';
import { seedRoles } from '../auth/roles.seed.js';
import { Centre } from '../centres/centre.model.js';
import { createUser, login } from '../../test/factories.js';
import { recordAudit } from './record.js';
import { AuditEntry } from './audit.model.js';

beforeEach(seedRoles);

const fakeReq = (user: unknown, centreId?: string) =>
  ({ user, params: centreId ? { centreId } : {} }) as unknown as Request;

describe('audit', () => {
  async function setup() {
    const a = await Centre.create({ name: 'A' });
    const b = await Centre.create({ name: 'B' });
    const mgr = await createUser({ username: 'mgr', name: 'Manager', memberships: [{ centreId: a.id, roleKeys: ['centre_manager'] }] });
    const other = await createUser({ username: 'other', name: 'Other', memberships: [{ centreId: a.id, roleKeys: ['nurse'] }] });
    await recordAudit(fakeReq(mgr, a.id), 'patient.create', 'patient', 'p1', { x: 1 });
    await recordAudit(fakeReq(other, a.id), 'session.close', 'session', 's1');
    await recordAudit(fakeReq(mgr, b.id), 'patient.create', 'patient', 'p2');
    return { a, b, mgr, other };
  }

  it('lists only the centre entries, newest first, with user name', async () => {
    const { a, mgr } = await setup();
    const res = await (await login('mgr')).get(`/api/centres/${a.id}/audit`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].action).toBe('session.close');
    expect(res.body[1]).toMatchObject({ action: 'patient.create', entityId: 'p1', details: { x: 1 }, user: { id: mgr.id, name: 'Manager' } });
  });

  it('filters by userId and by inclusive local dates', async () => {
    const { a, mgr } = await setup();
    const agent = await login('mgr');
    const byUser = await agent.get(`/api/centres/${a.id}/audit?userId=${mgr.id}`);
    expect(byUser.body.map((r: { action: string }) => r.action)).toEqual(['patient.create']);
    await AuditEntry.updateOne({ entityId: 'p1' }, { at: new Date('2026-01-10T12:00:00Z') });
    const day = await agent.get(`/api/centres/${a.id}/audit?from=2026-01-10&to=2026-01-10`);
    expect(day.body.map((r: { entityId: string }) => r.entityId)).toEqual(['p1']);
    const after = await agent.get(`/api/centres/${a.id}/audit?from=2026-01-11&to=2026-01-12`);
    expect(after.body).toHaveLength(0);
  });

  it('rejects bad query values with 400 validation', async () => {
    const { a } = await setup();
    const agent = await login('mgr');
    for (const qs of ['userId=nope', 'from=2026-1-1', 'to=2026-02-30']) {
      const res = await agent.get(`/api/centres/${a.id}/audit?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation');
    }
  });

  it('forbids a nurse', async () => {
    const { a } = await setup();
    expect((await (await login('other')).get(`/api/centres/${a.id}/audit`)).status).toBe(403);
  });

  it('stores null centre when no centreId param', async () => {
    const { mgr } = await setup();
    await recordAudit(fakeReq(mgr), 'x.y', 'x', '1');
    expect((await AuditEntry.findOne({ action: 'x.y' }))!.centreId).toBeNull();
  });
});
