import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { User } from '../auth/user.model.js';
import { AuditEntry } from '../audit/audit.model.js';
import { Patient } from './patient.model.js';
import { login, makeCentre, makePatient, programManager, staffIn } from '../../test/factories.js';

beforeEach(seedRoles);

const body = (o: object = {}) => ({
  name: 'Ali Hassan',
  phone: '0955111222',
  emergencyContact: { name: 'Sara', phone: '0933', relation: 'wife' },
  kidneyFailureCause: 'diabetes',
  login: { username: 'ali', password: 'secret123' },
  ...o,
});
const names = (r: { body: { name: string }[] }) => r.body.map((p) => p.name).sort();

describe('patients', () => {
  it('create makes a patient who logs in as kind patient with no centres; audited', async () => {
    const { centre } = await makeCentre();
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const res = await agent.post(`/api/centres/${centre.id}/patients`).send(body());
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Ali Hassan');
    expect(res.body.status).toBe('active');
    const p = await login('ali', 'secret123');
    const me = await p.get('/api/auth/me');
    expect(me.body.kind).toBe('patient');
    expect(me.body.centres).toEqual([]);
    expect((await User.findOne({ username: 'ali' }))!.kind).toBe('patient');
    expect(await AuditEntry.countDocuments({ action: 'patient.create' })).toBe(1);
  });

  it('duplicate username is 409 username_taken and creates no patient; validation 400', async () => {
    const { centre } = await makeCentre();
    const { agent } = await staffIn(centre.id, ['front_desk']);
    const url = `/api/centres/${centre.id}/patients`;
    expect((await agent.post(url).send(body())).status).toBe(201);
    const dup = await agent.post(url).send(body({ name: 'Other' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('username_taken');
    expect(await Patient.countDocuments()).toBe(1);
    expect((await agent.post(url).send(body({ login: { username: 'x', password: 'short' } }))).status).toBe(400);
    expect((await agent.post(url).send(body({ name: '' }))).status).toBe(400);
  });

  it('search by name and phone; default status active', async () => {
    const { centre } = await makeCentre();
    const { agent } = await staffIn(centre.id, ['front_desk']);
    await makePatient(centre.id, { name: 'Omar Khaled', phone: '0944000111' });
    await makePatient(centre.id, { name: 'Lina Said', phone: '0955999888' });
    await makePatient(centre.id, { name: 'Gone Guy', phone: '0900', status: 'discharged' });
    const url = `/api/centres/${centre.id}/patients`;
    expect(names(await agent.get(url))).toEqual(['Lina Said', 'Omar Khaled']);
    expect(names(await agent.get(`${url}?q=0955`))).toEqual(['Lina Said']);
    expect(names(await agent.get(`${url}?q=omar`))).toEqual(['Omar Khaled']);
    expect(names(await agent.get(`${url}?status=discharged`))).toEqual(['Gone Guy']);
    expect((await agent.get(`${url}?q=${encodeURIComponent('.*')}`)).body).toEqual([]);
  });

  it('patch updates and audits; nurse cannot patch', async () => {
    const { centre } = await makeCentre();
    const fd = await staffIn(centre.id, ['front_desk']);
    const nurse = await staffIn(centre.id, ['nurse']);
    const { patient } = await makePatient(centre.id);
    const url = `/api/centres/${centre.id}/patients/${patient.id}`;
    const ok = await fd.agent.patch(url).send({ notes: 'allergic', phone: '0999' });
    expect(ok.status).toBe(200);
    expect(ok.body.notes).toBe('allergic');
    expect((await fd.agent.get(url)).body.phone).toBe('0999');
    expect(await AuditEntry.countDocuments({ action: 'patient.update' })).toBe(1);
    expect((await nurse.agent.patch(url).send({ notes: 'x' })).status).toBe(403);
    expect((await nurse.agent.get(url)).status).toBe(200);
  });

  it('a patient of another centre is 404 for get and patch', async () => {
    const a = await makeCentre();
    const b = await makeCentre();
    const fd = await staffIn(a.centre.id, ['front_desk']);
    const { patient } = await makePatient(b.centre.id);
    const url = `/api/centres/${a.centre.id}/patients/${patient.id}`;
    expect((await fd.agent.get(url)).status).toBe(404);
    expect((await fd.agent.patch(url).send({ notes: 'x' })).status).toBe(404);
    expect((await fd.agent.get(`/api/centres/${a.centre.id}/patients/nonsense`)).status).toBe(404);
    expect((await Patient.findById(patient.id))!.notes).toBeUndefined();
  });

  it('closing a centre with an active patient is 409 has_active_patients', async () => {
    const { centre } = await makeCentre();
    const pm = await programManager();
    const { patient } = await makePatient(centre.id);
    const res = await pm.agent.post(`/api/centres/${centre.id}/close`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('has_active_patients');
    await Patient.updateOne({ _id: patient._id }, { status: 'discharged' });
    expect((await pm.agent.post(`/api/centres/${centre.id}/close`)).status).toBe(200);
  });
});
