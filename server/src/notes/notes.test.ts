import { describe, it, expect, beforeEach } from 'vitest';
import { AuditEntry } from '../audit/audit.model.js';
import { seedRoles } from '../auth/roles.seed.js';
import { addDays, todayLocal } from '../lib/dates.js';
import { makeCentre, makePatient, makeSession, staffIn } from '../../test/factories.js';
import { PatientNote } from './patient-note.model.js';

beforeEach(seedRoles);

async function setup() {
  const { centre, chairs, shifts } = await makeCentre();
  const { patient } = await makePatient(centre.id);
  const desk = await staffIn(centre.id, ['front_desk']);
  const nurse = await staffIn(centre.id, ['nurse']);
  const doctor = await staffIn(centre.id, ['doctor']);
  return { centre, chairs, shifts, patient, desk, nurse, doctor, url: `/api/centres/${centre.id}/patients/${patient.id}` };
}

describe('doctor patient notes', () => {
  it('appears in the timeline and in the next session recentNotes; audited', async () => {
    const { doctor, desk, url, centre, chairs, shifts, patient } = await setup();
    const post = await doctor.agent.post(`${url}/notes`).send({ text: '  Reduce dry weight  ' });
    expect(post.status).toBe(201);
    expect(post.body.text).toBe('Reduce dry weight');
    const tl = await desk.agent.get(`${url}/timeline`);
    expect(tl.body.notes).toHaveLength(1);
    expect(tl.body.notes[0].author.name).toBe(doctor.user.name);
    const s = await makeSession({
      centreId: centre._id, patientId: patient._id, date: addDays(todayLocal(), 1), chairId: chairs[0]!._id, shiftId: shifts[0]!._id, status: 'scheduled',
    });
    await PatientNote.create({ patientId: patient._id, centreId: centre._id, authorId: doctor.user._id, text: 'old', at: new Date(Date.now() - 40 * 86400000) });
    const detail = await desk.agent.get(`/api/centres/${centre.id}/sessions/${s.id}`);
    expect(detail.body.recentNotes.map((n: { text: string }) => n.text)).toEqual(['Reduce dry weight']);
    expect((await doctor.agent.get(`${url}/notes`)).body).toHaveLength(2);
    expect(await AuditEntry.countDocuments({ action: 'patient_note.create' })).toBe(1);
  });

  it('refuses nurses and invalid text', async () => {
    const { nurse, doctor, url } = await setup();
    expect((await nurse.agent.post(`${url}/notes`).send({ text: 'x' })).status).toBe(403);
    expect((await doctor.agent.post(`${url}/notes`).send({ text: '   ' })).status).toBe(400);
    expect((await doctor.agent.post(`${url}/notes`).send({ text: 'a'.repeat(2001) })).status).toBe(400);
  });
});

describe('patient notes across centres', () => {
  it('404s for a patient of another centre on both GET and POST, and writes nothing', async () => {
    const { patient } = await setup();
    const other = await makeCentre({ name: 'South' });
    const southDoctor = await staffIn(other.centre.id, ['doctor']);
    const foreign = `/api/centres/${other.centre.id}/patients/${patient.id}`;
    expect((await southDoctor.agent.get(`${foreign}/notes`)).status).toBe(404);
    expect((await southDoctor.agent.post(`${foreign}/notes`).send({ text: 'x' })).status).toBe(404);
    expect(await PatientNote.countDocuments()).toBe(0);
  });
});
