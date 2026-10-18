import request from 'supertest';
import { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { Role } from '../src/auth/role.model.js';
import { User, type UserDoc } from '../src/auth/user.model.js';
import { hashPassword } from '../src/auth/password.js';
import { Centre } from '../src/centres/centre.model.js';
import { Chair, type ChairDoc } from '../src/centres/chair.model.js';
import { Shift, type ShiftDoc } from '../src/centres/shift.model.js';
import { Patient, type PatientData } from '../src/patients/patient.model.js';
import { Session, type SessionData, type SessionDoc } from '../src/sessions/session.model.js';

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

export interface MakeCentreOpts {
  name?: string;
  chairs?: number;
  shifts?: { name: string; start: string; end: string }[];
}

export async function makeCentre(opts: MakeCentreOpts = {}) {
  const centre = await Centre.create({ name: opts.name ?? 'Centre' });
  const count = opts.chairs ?? 4;
  const chairs = (await Chair.create(
    Array.from({ length: count }, (_, i) => ({ centreId: centre._id, label: String(i + 1) })),
  )) as unknown as ChairDoc[];
  const shiftDefs = opts.shifts ?? [
    { name: 'Morning', start: '07:00', end: '11:30' },
    { name: 'Afternoon', start: '12:00', end: '16:30' },
  ];
  const shifts = (await Shift.create(shiftDefs.map((s) => ({ ...s, centreId: centre._id })))) as unknown as ShiftDoc[];
  return { centre, chairs, shifts };
}

/** Staff user with the given centre roles in `centreId`, already logged in. */
export async function staffIn(centreId: string | Types.ObjectId, roleKeys: string[], username?: string) {
  const user = await createUser({
    username: username ?? `staff-${roleKeys.join('-')}-${new Types.ObjectId().toHexString().slice(-6)}`,
    memberships: [{ centreId, roleKeys }],
  });
  const agent = await login(user.username);
  return { user, agent };
}

/** Patient account (User kind patient) plus its Patient record in `centreId`. */
export async function makePatient(
  centreId: string | Types.ObjectId,
  overrides: Partial<PatientData> & { username?: string; password?: string } = {},
) {
  const { username, password, ...fields } = overrides;
  const suffix = new Types.ObjectId().toHexString().slice(-6);
  const user = await createUser({
    username: username ?? `pt-${suffix}`,
    password,
    name: fields.name ?? `Patient ${suffix}`,
    kind: 'patient',
  });
  const patient = await Patient.create({ name: user.name, ...fields, centreId, userId: user._id });
  return { user, patient };
}

/**
 * Creates a Session, filling the shift/chair snapshots (shiftStart, shiftEnd, chairLabel) from the
 * given chair and shift unless overridden.
 */
export async function makeSession(
  overrides: Partial<Omit<SessionData, 'chairId' | 'shiftId' | 'patientId' | 'centreId' | 'status'>> & {
    status?: string;
    centreId: string | Types.ObjectId;
    patientId: string | Types.ObjectId;
    chairId: string | Types.ObjectId;
    shiftId: string | Types.ObjectId;
    date: string;
  },
): Promise<SessionDoc> {
  const [chair, shift] = await Promise.all([Chair.findById(overrides.chairId), Shift.findById(overrides.shiftId)]);
  return Session.create({
    chairLabel: chair?.label ?? '?',
    shiftStart: shift?.start ?? '00:00',
    shiftEnd: shift?.end ?? '00:00',
    ...overrides,
  });
}

export async function programManager() {
  const user = await createUser({ username: `pm-${new Types.ObjectId().toHexString().slice(-6)}`, globalRoleKeys: ['program_manager'] });
  const agent = await login(user.username);
  return { user, agent };
}
