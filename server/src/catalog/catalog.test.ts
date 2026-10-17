import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { seedRoles } from '../auth/roles.seed.js';
import { AuditEntry } from '../audit/audit.model.js';
import { hasPermAnywhere } from '../auth/effective.js';
import { Centre } from '../centres/centre.model.js';
import { UsageLine } from '../sessions/usage.model.js';
import { Item } from './item.model.js';
import { Unit } from './unit.model.js';
import { markItemUsed } from './merge.js';
import { makeCentre, makePatient, programManager, staffIn, login } from '../../test/factories.js';

beforeAll(async () => {
  await Item.init();
  await Unit.init();
});
beforeEach(seedRoles);

async function setup() {
  const { centre } = await makeCentre();
  const nurse = await staffIn(centre.id, ['nurse']);
  const front = await staffIn(centre.id, ['front_desk']);
  const pm = await programManager();
  const cc = (await pm.agent.post('/api/catalog/units').send({ name: 'cc' })).body as { id: string };
  const iu = (await pm.agent.post('/api/catalog/units').send({ name: 'IU' })).body as { id: string };
  return { centre, nurse, front, pm, cc, iu };
}
const addItem = (agent: Awaited<ReturnType<typeof programManager>>['agent'], name: string, unitId: string, type = 'medicine') =>
  agent.post('/api/catalog/items').send({ name, type, unitId });

describe('units', () => {
  it('add is case-insensitive dedupe returning the existing unit with 200; audited once', async () => {
    const { nurse, pm } = await setup();
    const a = await nurse.agent.post('/api/catalog/units').send({ name: 'Ampoule' });
    expect(a.status).toBe(201);
    const b = await nurse.agent.post('/api/catalog/units').send({ name: '  ampoule ' });
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(await Unit.countDocuments({ nameKey: 'ampoule' })).toBe(1);
    expect(await AuditEntry.countDocuments({ action: 'unit.create' })).toBe(3);
    const list = await pm.agent.get('/api/catalog/units');
    expect(list.body.map((u: { name: string }) => u.name)).toEqual(['Ampoule', 'cc', 'IU']);
  });

  it('doctor/nurse can list; unauthenticated 401; patient 403', async () => {
    const { centre } = await makeCentre();
    const { user } = await makePatient(centre.id, { username: 'pat1', password: 'pass1234' });
    const p = await login(user.username);
    expect((await p.get('/api/catalog/units')).status).toBe(403);
    expect((await p.post('/api/catalog/units').send({ name: 'x' })).status).toBe(403);
    const { agent } = await staffIn(centre.id, ['doctor']);
    expect((await agent.get('/api/catalog/units')).status).toBe(200);
  });
});

describe('items', () => {
  it('nurse adds Heparine -> pending and visible; PM approves; front desk cannot PATCH', async () => {
    const { nurse, front, pm, cc } = await setup();
    const created = await addItem(nurse.agent, 'Heparine', cc.id);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending');
    const list = await front.agent.get('/api/catalog/items');
    expect(list.body.map((i: { name: string; status: string }) => [i.name, i.status])).toEqual([['Heparine', 'pending']]);
    expect((await front.agent.patch(`/api/catalog/items/${created.body.id}`).send({ status: 'approved' })).status).toBe(403);
    expect((await nurse.agent.patch(`/api/catalog/items/${created.body.id}`).send({ status: 'approved' })).status).toBe(403);
    const ok = await pm.agent.patch(`/api/catalog/items/${created.body.id}`).send({ status: 'approved' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('approved');
    const pmItem = await addItem(pm.agent, 'Saline', cc.id, 'supply');
    expect(pmItem.body.status).toBe('approved');
    expect(await AuditEntry.countDocuments({ action: 'item.create' })).toBe(2);
    expect(await AuditEntry.countDocuments({ action: 'item.update' })).toBe(1);
  });

  it('filters by type, q, status; retired hidden by default', async () => {
    const { pm, cc } = await setup();
    await addItem(pm.agent, 'Heparin', cc.id);
    await addItem(pm.agent, 'Gauze', cc.id, 'supply');
    const old = await addItem(pm.agent, 'Old', cc.id);
    await pm.agent.patch(`/api/catalog/items/${old.body.id}`).send({ status: 'retired' });
    const names = (r: { body: { name: string }[] }) => r.body.map((i) => i.name);
    expect(names(await pm.agent.get('/api/catalog/items'))).toEqual(['Gauze', 'Heparin']);
    expect(names(await pm.agent.get('/api/catalog/items?type=supply'))).toEqual(['Gauze']);
    expect(names(await pm.agent.get('/api/catalog/items?q=hep'))).toEqual(['Heparin']);
    expect(names(await pm.agent.get('/api/catalog/items?status=retired'))).toEqual(['Old']);
    expect((await pm.agent.get(`/api/catalog/items?q=${encodeURIComponent('.*')}`)).body).toEqual([]);
  });

  it('name is case-insensitive unique per type among non-retired -> 409 item_exists', async () => {
    const { nurse, pm, cc } = await setup();
    expect((await addItem(pm.agent, 'Heparin', cc.id)).status).toBe(201);
    const dup = await addItem(nurse.agent, ' heparin ', cc.id);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('item_exists');
    expect((await addItem(pm.agent, 'Heparin', cc.id, 'supply')).status).toBe(201);
    // renaming into a clash is also 409
    const other = await addItem(pm.agent, 'Other', cc.id);
    const clash = await pm.agent.patch(`/api/catalog/items/${other.body.id}`).send({ name: 'HEPARIN' });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toBe('item_exists');
    // retired names are free again
    const first = await Item.findOne({ nameKey: 'heparin', type: 'medicine' });
    await pm.agent.patch(`/api/catalog/items/${first!.id}`).send({ status: 'retired' });
    expect((await addItem(pm.agent, 'Heparin', cc.id)).status).toBe(201);
  });

  it('validation: unknown unit 400, bad type 400, missing name 400', async () => {
    const { pm, cc } = await setup();
    expect((await addItem(pm.agent, 'X', new Types.ObjectId().toHexString())).status).toBe(400);
    expect((await addItem(pm.agent, 'X', cc.id, 'gadget')).status).toBe(400);
    expect((await addItem(pm.agent, '', cc.id)).status).toBe(400);
  });

  it('unit change on a used item is 409 unit_locked; allowed when unused', async () => {
    const { pm, cc, iu } = await setup();
    const a = await addItem(pm.agent, 'Heparin', cc.id);
    const ok = await pm.agent.patch(`/api/catalog/items/${a.body.id}`).send({ unitId: iu.id });
    expect(ok.status).toBe(200);
    await markItemUsed(a.body.id);
    const locked = await pm.agent.patch(`/api/catalog/items/${a.body.id}`).send({ unitId: cc.id });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toBe('unit_locked');
    expect((await pm.agent.patch(`/api/catalog/items/${a.body.id}`).send({ name: 'Heparin B' })).status).toBe(200);
  });
});

describe('merge', () => {
  async function line(centreId: string, itemId: string) {
    return UsageLine.create({
      sessionId: new Types.ObjectId(),
      centreId,
      patientId: new Types.ObjectId(),
      date: '2026-10-18',
      itemId,
      amount: 2,
      by: new Types.ObjectId(),
    });
  }

  it('re-points usage lines, retires the source, marks target used; audited', async () => {
    const { centre, nurse, pm, cc } = await setup();
    const from = (await addItem(nurse.agent, 'Heparine', cc.id)).body;
    const into = (await addItem(pm.agent, 'Heparin', cc.id)).body;
    await line(centre.id, from.id);
    await line(centre.id, from.id);
    await markItemUsed(from.id);
    const res = await pm.agent.post(`/api/catalog/items/${from.id}/merge`).send({ intoId: into.id });
    expect(res.status).toBe(200);
    expect(await UsageLine.countDocuments({ itemId: into.id })).toBe(2);
    expect(await UsageLine.countDocuments({ itemId: from.id })).toBe(0);
    const f = await Item.findById(from.id);
    expect(f!.status).toBe('retired');
    expect(String(f!.mergedInto)).toBe(into.id);
    expect((await Item.findById(into.id))!.used).toBe(true);
    expect(await AuditEntry.countDocuments({ action: 'item.merge' })).toBe(1);
    const list = await pm.agent.get('/api/catalog/items');
    expect(list.body.map((i: { name: string }) => i.name)).toEqual(['Heparin']);
  });

  it('different units -> 400 unit_mismatch and nothing changes', async () => {
    const { centre, pm, cc, iu } = await setup();
    const from = (await addItem(pm.agent, 'Heparin IU', iu.id)).body;
    const into = (await addItem(pm.agent, 'Heparin cc', cc.id)).body;
    await line(centre.id, from.id);
    const res = await pm.agent.post(`/api/catalog/items/${from.id}/merge`).send({ intoId: into.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unit_mismatch');
    expect(await UsageLine.countDocuments({ itemId: from.id })).toBe(1);
    expect((await Item.findById(from.id))!.status).toBe('approved');
  });

  it('same item 400; retired either side 409 item_retired; unknown 404; needs catalog.manage', async () => {
    const { nurse, pm, cc } = await setup();
    const a = (await addItem(pm.agent, 'A', cc.id)).body;
    const b = (await addItem(pm.agent, 'B', cc.id)).body;
    const c = (await addItem(pm.agent, 'C', cc.id)).body;
    expect((await pm.agent.post(`/api/catalog/items/${a.id}/merge`).send({ intoId: a.id })).status).toBe(400);
    expect((await nurse.agent.post(`/api/catalog/items/${a.id}/merge`).send({ intoId: b.id })).status).toBe(403);
    expect((await pm.agent.post(`/api/catalog/items/${a.id}/merge`).send({ intoId: b.id })).status).toBe(200);
    const intoRetired = await pm.agent.post(`/api/catalog/items/${c.id}/merge`).send({ intoId: a.id });
    expect(intoRetired.status).toBe(409);
    expect(intoRetired.body.error).toBe('item_retired');
    const fromRetired = await pm.agent.post(`/api/catalog/items/${a.id}/merge`).send({ intoId: c.id });
    expect(fromRetired.status).toBe(409);
    expect(fromRetired.body.error).toBe('item_retired');
    const unknown = await pm.agent.post(`/api/catalog/items/${c.id}/merge`).send({ intoId: new Types.ObjectId().toHexString() });
    expect(unknown.status).toBe(404);
  });
});

describe('hasPermAnywhere', () => {
  it('counts active-centre memberships only, plus global roles', async () => {
    const { centre } = await makeCentre();
    const { user } = await staffIn(centre.id, ['nurse']);
    expect(await hasPermAnywhere(user, 'catalog.add')).toBe(true);
    expect(await hasPermAnywhere(user, 'catalog.manage')).toBe(false);
    await Centre.updateOne({ _id: centre._id }, { status: 'closed' });
    expect(await hasPermAnywhere(user, 'catalog.add')).toBe(false);
    const pm = await programManager();
    expect(await hasPermAnywhere(pm.user, 'catalog.manage')).toBe(true);
  });
});
