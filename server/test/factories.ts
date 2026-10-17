import request from 'supertest';
import type { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { Role } from '../src/auth/role.model.js';
import { User, type UserDoc } from '../src/auth/user.model.js';
import { hashPassword } from '../src/auth/password.js';

let sharedApp: ReturnType<typeof createApp> | undefined;
export const getApp = () => (sharedApp ??= createApp());

async function roleIds(keys: string[]): Promise<Types.ObjectId[]> {
  const roles = await Role.find({ key: { $in: keys } });
  if (roles.length !== new Set(keys).size) throw new Error(`unknown role key in ${keys.join(',')} (seedRoles first)`);
  return roles.map((r) => r._id);
}

export interface CreateUserOpts {
  username: string;
  password?: string;
  name?: string;
  kind?: 'staff' | 'patient';
  globalRoleKeys?: string[];
  memberships?: { centreId: string | Types.ObjectId; roleKeys: string[] }[];
}

export async function createUser(opts: CreateUserOpts): Promise<UserDoc> {
  const memberships = [];
  for (const m of opts.memberships ?? []) {
    memberships.push({ centreId: m.centreId, roleIds: await roleIds(m.roleKeys) });
  }
  return User.create({
    username: opts.username,
    passwordHash: await hashPassword(opts.password ?? 'pass1234'),
    name: opts.name ?? opts.username,
    kind: opts.kind ?? 'staff',
    globalRoleIds: await roleIds(opts.globalRoleKeys ?? []),
    memberships,
  });
}

export async function login(username: string, password = 'pass1234'): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(getApp());
  const res = await agent.post('/api/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}
