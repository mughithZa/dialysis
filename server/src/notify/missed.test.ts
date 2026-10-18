import { describe, it, expect } from 'vitest';
import { Session } from '../sessions/session.model.js';
import { markMissed } from './jobs.js';
import { makeCentre, makePatient, makeSession } from '../../test/factories.js';

async function setup() {
  const { centre, chairs, shifts } = await makeCentre();
  const mk = async (date: string, status = 'scheduled') => {
    const { patient } = await makePatient(centre.id);
    return makeSession({
      centreId: centre.id, patientId: patient.id, chairId: chairs[0]!.id, shiftId: shifts[0]!.id,
      date, kind: 'regular', status,
    });
  };
  return { mk };
}

describe('markMissed', () => {
  it('uses the local date: 23:30 Damascus keeps today, 00:30 next day marks it', async () => {
    const { mk } = await setup();
    const yesterday = await mk('2026-10-17');
    const today = await mk('2026-10-18');
    expect(await markMissed(new Date('2026-10-18T20:30:00Z'))).toBe(1);
    expect((await Session.findById(yesterday._id))!.status).toBe('missed');
    expect((await Session.findById(today._id))!.status).toBe('scheduled');
    expect(await markMissed(new Date('2026-10-18T21:30:00Z'))).toBe(1);
    expect((await Session.findById(today._id))!.status).toBe('missed');
  });

  it('only touches scheduled sessions', async () => {
    const { mk } = await setup();
    const done = await mk('2026-10-10', 'completed');
    const postponed = await mk('2026-10-10', 'postponed');
    expect(await markMissed(new Date('2026-10-18T12:00:00Z'))).toBe(0);
    expect((await Session.findById(done._id))!.status).toBe('completed');
    expect((await Session.findById(postponed._id))!.status).toBe('postponed');
  });
});
