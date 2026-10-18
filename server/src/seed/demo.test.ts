import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getApp } from '../../test/factories.js';
import { User } from '../auth/user.model.js';
import { Patient } from '../patients/patient.model.js';
import { Plan } from '../schedule/plan.model.js';
import { Session } from '../sessions/session.model.js';
import { Item } from '../catalog/item.model.js';
import { UsageLine } from '../sessions/usage.model.js';
import { todayLocal } from '../lib/dates.js';
import { assertSeedAllowed, seedDemo } from './demo.js';

const counts = async () => ({
  users: await User.countDocuments(),
  patients: await Patient.countDocuments(),
  plans: await Plan.countDocuments({ to: null }),
  sessions: await Session.countDocuments(),
  items: await Item.countDocuments(),
  usage: await UsageLine.countDocuments(),
});

describe('seedDemo', () => {
  it('seeds once, is idempotent, and produces a usable dataset', async () => {
    expect((await seedDemo()).created).toBe(true);
    const first = await counts();
    expect(first.patients).toBe(20);
    expect(first.plans).toBe(20);
    expect(first.items).toBe(9);
    expect(first.sessions).toBeGreaterThan(0);

    expect((await seedDemo()).created).toBe(false);
    expect(await counts()).toEqual(first);

    const pm = request.agent(getApp());
    expect((await pm.post('/api/auth/login').send({ username: 'pm', password: 'demo1234' })).status).toBe(200);

    const doctor = await User.findOne({ username: 'doctor' });
    expect(doctor!.memberships).toHaveLength(2);

    const month = todayLocal().slice(0, 7);
    const stats = await pm.get(`/api/stats?month=${month}`);
    expect(stats.status).toBe(200);
    const withData = (stats.body as { sessions: number; medicines: unknown[] }[]).filter(
      (c) => c.sessions > 0 && c.medicines.length > 0,
    );
    expect(withData.length).toBeGreaterThanOrEqual(1);
  });
});

describe('assertSeedAllowed', () => {
  it('throws unless ALLOW_DEMO_SEED=1', () => {
    expect(() => assertSeedAllowed({})).toThrow(/ALLOW_DEMO_SEED/);
    expect(() => assertSeedAllowed({ ALLOW_DEMO_SEED: '0' })).toThrow();
    expect(() => assertSeedAllowed({ ALLOW_DEMO_SEED: '1' })).not.toThrow();
  });
});
