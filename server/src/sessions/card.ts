import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { User } from '../auth/user.model.js';
import { Patient } from '../patients/patient.model.js';
import { resolveRoster } from '../schedule/roster.js';
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
  /** Snapshot times (fall back to the shift for sessions created before snapshots existed). */
  start: string;
  end: string;
  chairLabel: string;
  /** Nurse covering this machine and block: the frozen snapshot once final, else (scheduled/active) the roster for the date. */
  nurse: { id: string; name: string } | null;
  /** Who ran the session (set when it is opened). */
  runBy: { id: string; name: string } | null;
}

/** Builds display cards (and the nurse assigned to each chair/shift) for sessions of one centre. */
export async function toSessionCards(
  centreId: string,
  sessions: SessionDoc[],
  /** Sessions whose patient has since moved to another centre are skipped unless `includeMoved`. */
  { includeMoved = false }: { includeMoved?: boolean } = {},
): Promise<{ card: SessionCard; nurseId: string | undefined }[]> {
  const [chairs, shifts, patients, ordered, runners] = await Promise.all([
    Chair.find({ centreId }),
    Shift.find({ centreId }),
    Patient.find({ _id: { $in: sessions.map((s) => s.patientId) } }),
    withActiveOrders(sessions),
    User.find({ _id: { $in: sessions.map((s) => s.runBy).filter(Boolean) } }),
  ]);
  const runnerById = new Map(runners.map((u) => [u.id as string, u]));
  // a frozen snapshot (final statuses) wins; a session not yet final (scheduled or active) falls back to the roster
  // for its date (resolved once per date); a final one without a snapshot shows no nurse rather than today's roster
  const rosterByDate = new Map<string, Map<string, string>>();
  const nurseIdOf = new Map<string, string | undefined>();
  for (const s of sessions) {
    let id = s.rosterNurseId ? String(s.rosterNurseId) : undefined;
    if (!id && (s.status === 'scheduled' || s.status === 'active')) {
      if (!rosterByDate.has(s.date)) rosterByDate.set(s.date, await resolveRoster(centreId, s.date));
      id = rosterByDate.get(s.date)!.get(`${s.shiftId}:${s.chairId}`);
    }
    nurseIdOf.set(s.id as string, id);
  }
  const nurses = new Map(
    (await User.find({ _id: { $in: [...new Set([...nurseIdOf.values()].filter(Boolean))] } })).map((u) => [u.id as string, u.name]),
  );
  const chairById = new Map(chairs.map((c) => [c.id as string, c]));
  const shiftById = new Map(shifts.map((s) => [s.id as string, s]));
  const patientById = new Map(patients.map((p) => [p.id as string, p]));
  const out: { card: SessionCard; nurseId: string | undefined }[] = [];
  for (const s of sessions) {
    const chair = chairById.get(String(s.chairId));
    const shift = shiftById.get(String(s.shiftId));
    const patient = patientById.get(String(s.patientId));
    const nurseId = nurseIdOf.get(s.id as string);
    const runner = s.runBy ? runnerById.get(String(s.runBy)) : undefined;
    if (!chair || !shift || !patient || (!includeMoved && String(patient.centreId) !== String(centreId))) continue;
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
        start: s.shiftStart ?? shift.start,
        end: s.shiftEnd ?? shift.end,
        chairLabel: s.chairLabel ?? chair.label,
        nurse: nurseId ? { id: nurseId, name: nurses.get(nurseId) ?? '' } : null,
        runBy: runner ? { id: runner.id as string, name: runner.name } : null,
      },
      nurseId,
    });
  }
  return out;
}
