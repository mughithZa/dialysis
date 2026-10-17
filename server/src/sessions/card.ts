import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Patient } from '../patients/patient.model.js';
import { ChairAssignment } from '../schedule/assignment.model.js';
import { withActiveOrders } from '../orders/service.js';
import type { SessionDoc } from './session.model.js';

export interface SessionCard {
  id: string;
  date: string;
  status: SessionDoc['status'];
  kind: SessionDoc['kind'];
  chair: { id: string; label: string };
  shift: { id: string; name: string; start: string; end: string };
  patient: { id: string; name: string };
  hasActiveOrders: boolean;
}

/** Builds display cards (and the nurse assigned to each chair/shift) for sessions of one centre. */
export async function toSessionCards(
  centreId: string,
  sessions: SessionDoc[],
): Promise<{ card: SessionCard; nurseId: string | undefined }[]> {
  const [assignments, chairs, shifts, patients, ordered] = await Promise.all([
    ChairAssignment.find({ centreId }),
    Chair.find({ centreId }),
    Shift.find({ centreId }),
    Patient.find({ _id: { $in: sessions.map((s) => s.patientId) } }),
    withActiveOrders(sessions),
  ]);
  const nurseOf = new Map(assignments.map((a) => [`${a.chairId}:${a.shiftId}`, String(a.nurseId)]));
  const chairById = new Map(chairs.map((c) => [c.id as string, c]));
  const shiftById = new Map(shifts.map((s) => [s.id as string, s]));
  const patientById = new Map(patients.map((p) => [p.id as string, p]));
  const out: { card: SessionCard; nurseId: string | undefined }[] = [];
  for (const s of sessions) {
    const chair = chairById.get(String(s.chairId));
    const shift = shiftById.get(String(s.shiftId));
    const patient = patientById.get(String(s.patientId));
    if (!chair || !shift || !patient) continue;
    out.push({
      card: {
        id: s.id as string,
        date: s.date,
        status: s.status,
        kind: s.kind,
        chair: { id: chair.id as string, label: chair.label },
        shift: { id: shift.id as string, name: shift.name, start: shift.start, end: shift.end },
        patient: { id: patient.id as string, name: patient.name },
        hasActiveOrders: ordered.has(`${s.patientId}:${s.date}`),
      },
      nurseId: nurseOf.get(`${s.chairId}:${s.shiftId}`),
    });
  }
  return out;
}
