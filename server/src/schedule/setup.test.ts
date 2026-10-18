import { describe, it, expect, beforeEach, vi } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { Role } from '../auth/role.model.js';
import { Centre } from '../centres/centre.model.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { withTransaction } from '../db.js';
import { addDays, todayLocal, weekdayOf } from '../lib/dates.js';
import { AuditEntry } from '../audit/audit.model.js';
import { makePatient, makeCentre, staffIn, makeSession } from '../../test/factories.js';
import { Plan } from './plan.model.js';
import { applySetup, proposeBlocks } from './setup.js';

beforeEach(seedRoles);

const WORKING = [0, 1, 2, 3, 4, 6];

const blocks = [
  { name: 'Morning', start: '08:00', end: '12:00' },
  { name: 'Afternoon', start: '12:00', end: '16:00' },
];
const body = (over: object = {}) => ({ machineCount: 8, blocks, workingDays: [0, 1, 2, 3, 4, 6], ...over });

describe('proposeBlocks', () => {
  it('splits equally', () => {
    expect(proposeBlocks('08:00', '16:00', 2)).toEqual([
      { name: 'Session 1', start: '08:00', end: '12:00' },
      { name: 'Session 2', start: '12:00', end: '16:00' },
    ]);
  });
  it('rounds down to the minute and the last block ends at day end', () => {
    expect(proposeBlocks('08:00', '17:00', 2)).toEqual([
      { name: 'Session 1', start: '08:00', end: '12:30' },
      { name: 'Session 2', start: '12:30', end: '17:00' },
    ]);
    const b = proposeBlocks('08:00', '17:00', 4);
    expect(b[3]!.end).toBe('17:00');
    expect(b[0]!.end).toBe('10:15');
  });
});

describe('schedule setup', () => {
  it('seeds front_desk with the new permissions', async () => {
    const fd = await Role.findOne({ key: 'front_desk' });
    for (const p of ['schedule.setup', 'sessions.run', 'sessions.recordUsage', 'sessions.recordVitals', 'sessions.addNotes']) {
      expect(fd!.permissions).toContain(p);
    }
  });

  it('PUT then GET returns machines 1..8, blocks and working days; audited', async () => {
    const centre = await Centre.create({ name: 'C' });
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const put = await agent.put(`/api/centres/${centre.id}/schedule/setup`).send(body());
    expect(put.status).toBe(200);
    const get = await agent.get(`/api/centres/${centre.id}/schedule/setup`);
    expect(get.body.machines.map((m: { label: string }) => m.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(get.body.blocks).toMatchObject(blocks);
    expect(get.body.workingDays).toEqual([0, 1, 2, 3, 4, 6]);
    expect(await AuditEntry.countDocuments({ action: 'schedule.setup' })).toBe(1);
  });

  it('defaults working days to Sat-Thu on a centre', async () => {
    const centre = await Centre.create({ name: 'C' });
    expect([...centre.workingDays]).toEqual([0, 1, 2, 3, 4, 6]);
  });

  it('nurse 403, front desk 200', async () => {
    const { centre } = await makeCentre();
    const nurse = await staffIn(centre.id, ['nurse']);
    expect((await nurse.agent.put(`/api/centres/${centre.id}/schedule/setup`).send(body())).status).toBe(403);
    const fd = await staffIn(centre.id, ['front_desk']);
    expect((await fd.agent.put(`/api/centres/${centre.id}/schedule/setup`).send(body())).status).toBe(200);
  });

  it('overlapping blocks 400 blocks_overlap; start>=end 400', async () => {
    const { centre } = await makeCentre();
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const url = `/api/centres/${centre.id}/schedule/setup`;
    const r = await agent.put(url).send(body({ blocks: [blocks[0], { name: 'B', start: '11:00', end: '14:00' }] }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('blocks_overlap');
    expect((await agent.put(url).send(body({ blocks: [{ name: 'B', start: '11:00', end: '11:00' }] }))).status).toBe(400);
  });

  it('raising count reactivates retired machines, lowering retires highest', async () => {
    const centre = await Centre.create({ name: 'C' });
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const url = `/api/centres/${centre.id}/schedule/setup`;
    await agent.put(url).send(body({ machineCount: 4 }));
    const first = await Chair.findOne({ centreId: centre.id, label: '4' });
    await agent.put(url).send(body({ machineCount: 2 }));
    expect((await agent.get(url)).body.machines).toHaveLength(2);
    await agent.put(url).send(body({ machineCount: 4 }));
    expect((await Chair.findOne({ centreId: centre.id, label: '4' }))!.id).toBe(first!.id);
    expect(await Chair.countDocuments({ centreId: centre.id })).toBe(4);
  });

  async function futureSession(centreId: string, chairId: string, shiftId: string, date: string) {
    const { patient } = await makePatient(centreId);
    return makeSession({ centreId, patientId: patient._id, date, chairId, shiftId, status: 'scheduled' });
  }

  it('lowering count with a future scheduled session on machine 7 -> 409 in_use', async () => {
    const centre = await Centre.create({ name: 'C' });
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const url = `/api/centres/${centre.id}/schedule/setup`;
    await agent.put(url).send(body());
    const setup = (await agent.get(url)).body;
    const m7 = setup.machines.find((m: { label: string }) => m.label === '7');
    await futureSession(centre.id, m7.id, setup.blocks[0].id, addDays(todayLocal(), 1));
    const r = await agent.put(url).send({ ...body({ machineCount: 6 }), blocks: setup.blocks });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('in_use');
    expect((await agent.get(url)).body.machines).toHaveLength(8);
  });

  /** First date after today that falls on a working day of the default centre (never a Friday). */
  function nextWorkingDate(): string {
    let d = addDays(todayLocal(), 1);
    while (!WORKING.includes(weekdayOf(d))) d = addDays(d, 1);
    return d;
  }

  it('removing a block or a working day used by a future session -> 409 in_use', async () => {
    const centre = await Centre.create({ name: 'C' });
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const url = `/api/centres/${centre.id}/schedule/setup`;
    await agent.put(url).send(body());
    const setup = (await agent.get(url)).body;
    const date = nextWorkingDate();
    await futureSession(centre.id, setup.machines[0].id, setup.blocks[1].id, date);
    const rb = await agent.put(url).send({ ...body(), blocks: [setup.blocks[0]] });
    expect([rb.status, rb.body.error]).toEqual([409, 'in_use']);
    const wd = weekdayOf(date);
    const rw = await agent.put(url).send({ ...body(), blocks: setup.blocks, workingDays: WORKING.filter((d) => d !== wd) });
    expect([rw.status, rw.body.error]).toEqual([409, 'in_use']);
  });

  it('an active session today counts as in use', async () => {
    const centre = await Centre.create({ name: 'C', workingDays: [0, 1, 2, 3, 4, 5, 6] });
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const url = `/api/centres/${centre.id}/schedule/setup`;
    await agent.put(url).send(body({ workingDays: [0, 1, 2, 3, 4, 5, 6] }));
    const setup = (await agent.get(url)).body;
    const { patient } = await makePatient(centre.id);
    await makeSession({
      centreId: centre.id, patientId: patient._id, date: todayLocal(),
      chairId: setup.machines[7].id, shiftId: setup.blocks[1].id, status: 'active',
    });
    const r = await agent.put(url).send({ ...body({ machineCount: 7, workingDays: [0, 1, 2, 3, 4, 5, 6] }), blocks: setup.blocks });
    expect([r.status, r.body.error]).toEqual([409, 'in_use']);
  });

  async function planOn(centreId: string, chairId: string, shiftId: string, weekday: number, to: string | null = null) {
    const { patient } = await makePatient(centreId);
    return Plan.create({ centreId, patientId: patient._id, items: [{ weekday, shiftId, chairId }], from: todayLocal(), to });
  }

  it('retiring a machine used by an open plan item -> 409 in_use', async () => {
    const centre = await Centre.create({ name: 'C' });
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const url = `/api/centres/${centre.id}/schedule/setup`;
    await agent.put(url).send(body());
    const setup = (await agent.get(url)).body;
    const m7 = setup.machines.find((m: { label: string }) => m.label === '7');
    await planOn(centre.id, m7.id, setup.blocks[0].id, 6);
    const r = await agent.put(url).send({ ...body({ machineCount: 6 }), blocks: setup.blocks });
    expect([r.status, r.body.error]).toEqual([409, 'in_use']);
    expect((await agent.get(url)).body.machines).toHaveLength(8);
  });

  it('plan items block removing their block or weekday while the plan holds (to empty or >= today); ended plans do not', async () => {
    const centre = await Centre.create({ name: 'C' });
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const url = `/api/centres/${centre.id}/schedule/setup`;
    await agent.put(url).send(body());
    const setup = (await agent.get(url)).body;
    const dropBlock = () => agent.put(url).send({ ...body(), blocks: [setup.blocks[0]] });
    const dropSaturday = () => agent.put(url).send({ ...body(), blocks: setup.blocks, workingDays: [0, 1, 2, 3, 4] });

    const ended = await planOn(centre.id, setup.machines[0].id, setup.blocks[1].id, 6, addDays(todayLocal(), -1));
    ended.from = addDays(todayLocal(), -30);
    await ended.save();
    expect((await dropSaturday()).status).toBe(200);
    expect((await agent.put(url).send({ ...body(), blocks: setup.blocks })).status).toBe(200);

    const endsLater = await planOn(centre.id, setup.machines[0].id, setup.blocks[1].id, 6, todayLocal());
    expect((await dropBlock()).status).toBe(409);
    expect((await dropSaturday()).status).toBe(409);
    await endsLater.deleteOne();

    await planOn(centre.id, setup.machines[0].id, setup.blocks[1].id, 6);
    expect((await dropBlock()).status).toBe(409);
    expect((await dropSaturday()).status).toBe(409);
  });

  it('reads usage inside the transaction (an uncommitted plan in the same transaction counts)', async () => {
    const centre = await Centre.create({ name: 'C' });
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const url = `/api/centres/${centre.id}/schedule/setup`;
    await agent.put(url).send(body());
    const setup = (await agent.get(url)).body;
    const { patient } = await makePatient(centre.id);
    await expect(
      withTransaction(async (session) => {
        await Plan.create(
          [{ centreId: centre.id, patientId: patient._id, items: [{ weekday: 6, shiftId: setup.blocks[1].id, chairId: setup.machines[0].id }], from: todayLocal() }],
          { session },
        );
        await applySetup(centre.id, { ...body(), blocks: [setup.blocks[0]] }, session);
      }),
    ).rejects.toMatchObject({ status: 409, code: 'in_use' });
  });

  it('editing a block keeps its id and retimes it', async () => {
    const centre = await Centre.create({ name: 'C' });
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const url = `/api/centres/${centre.id}/schedule/setup`;
    await agent.put(url).send(body());
    const s1 = (await agent.get(url)).body;
    const r = await agent.put(url).send({ ...body(), blocks: [{ ...s1.blocks[0], end: '11:00' }, s1.blocks[1]] });
    expect(r.status).toBe(200);
    expect(r.body.blocks[0]).toMatchObject({ id: s1.blocks[0].id, end: '11:00' });
    expect(await Shift.countDocuments({ centreId: centre.id })).toBe(2);
  });

  it('a refresh failure after a committed save is logged and the saved setup is still returned', async () => {
    const centre = await Centre.create({ name: 'C' });
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const url = `/api/centres/${centre.id}/schedule/setup`;
    await agent.put(url).send(body());
    const s1 = (await agent.get(url)).body;
    const boom = vi.spyOn(Plan, 'distinct').mockRejectedValueOnce(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await agent.put(url).send({ ...body(), blocks: [{ ...s1.blocks[0], end: '11:00' }, s1.blocks[1]] });
      expect(r.status).toBe(200);
      expect(r.body.blocks[0]).toMatchObject({ id: s1.blocks[0].id, end: '11:00' });
      expect(boom).toHaveBeenCalled();
      expect(err).toHaveBeenCalled();
      expect((await Shift.findById(s1.blocks[0].id))!.end).toBe('11:00');
    } finally {
      boom.mockRestore();
      err.mockRestore();
    }
  });
});
