import { describe, it, expect } from 'vitest';
import { User } from '../auth/user.model.js';
import { login } from '../../test/factories.js';
import { createProgramManager, pmFromEnv } from './create-pm.js';

const env = { CREATE_PM_USERNAME: 'Boss', CREATE_PM_NAME: 'The Boss', CREATE_PM_PASSWORD: 'secret123' };

describe('create-pm', () => {
  it('reads and validates the env', () => {
    expect(pmFromEnv(env)).toEqual({ username: 'Boss', name: 'The Boss', password: 'secret123' });
    expect(() => pmFromEnv({ ...env, CREATE_PM_PASSWORD: 'short' })).toThrow(/at least 8/);
    expect(() => pmFromEnv({ CREATE_PM_NAME: 'x', CREATE_PM_PASSWORD: 'secret123' })).toThrow(/CREATE_PM_USERNAME/);
  });

  it('on an empty DB creates the roles and the PM once; the PM can create a centre', async () => {
    await createProgramManager(pmFromEnv(env));
    await expect(createProgramManager({ username: 'other', name: 'Other', password: 'secret123' })).rejects.toThrow(
      /already exists/,
    );
    expect(await User.countDocuments()).toBe(1);
    const pm = await login('boss', 'secret123');
    const res = await pm
      .post('/api/centres')
      .send({ name: 'North', manager: { username: 'northmgr', password: 'secret123', name: 'North Manager' } });
    expect(res.status).toBe(201);
  });
});
