import { Router, type Request } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { DISCHARGE_REASONS } from '../patients/patient.model.js';
import { loadPatientInCentre } from '../patients/load.js';
import { validate } from '../lib/validate.js';
import mongoose from 'mongoose';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { todayLocal } from '../lib/dates.js';
import { Role } from '../auth/role.model.js';
import { User } from '../auth/user.model.js';
import { Session, type SessionDoc } from '../sessions/session.model.js';
import { toSessionCards } from '../sessions/card.js';
import { withTransaction } from '../db.js';
import { recordAudit } from '../audit/record.js';
import { requirePerm } from '../auth/middleware.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Patient } from '../patients/patient.model.js';
import { bookPlan, changePlan, endPlans, type BookResult } from './booking.js';
import { Plan, type PlanDoc } from './plan.model.js';
import { freeMachines, planHolds } from './slots.js';
import { resolveRoster } from './roster.js';
import { Centre } from '../centres/centre.model.js';
import { addDays, weekdayOf } from '../lib/dates.js';
import { LIVE_STATUSES } from '../sessions/session.model.js';
import { buildBoard } from './board.js';

export const scheduleRouter = Router({ mergeParams: true });

const centreOf = (req: Request) => String(req.params.centreId);

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => DateTime.fromISO(s, { zone: 'utc' }).isValid);

// ---------- plans and bookings ----------

const planItems = z
  .array(z.object({ weekday: z.number().int().min(0).max(6), shiftId: z.string().min(1), chairId: z.string().min(1) }))
  .min(1)
  .max(7)
  .refine((items) => new Set(items.map((i) => `${i.weekday}:${i.shiftId}`)).size === items.length);

const bookBody = z.object({
  items: planItems,
  from: localDate,
  repeat: z.enum(['once', 'weekly']),
  to: localDate.nullable().optional(),
});
const changeBody = z.object({ items: planItems, from: localDate, to: localDate.nullable().optional() });

const planDto = (p: PlanDoc) => ({
  id: p.id as string,
  patientId: String(p.patientId),
  items: p.items.map((i) => ({ weekday: i.weekday, shiftId: String(i.shiftId), chairId: String(i.chairId) })),
  from: p.from,
  to: p.to ?? null,
  repeat: p.repeat,
});

const bookedSessionDto = (s: SessionDoc) => ({
  id: s.id as string,
  date: s.date,
  shiftId: String(s.shiftId),
  chairId: String(s.chairId),
  shiftStart: s.shiftStart,
  shiftEnd: s.shiftEnd,
  chairLabel: s.chairLabel,
  kind: s.kind,
  status: s.status,
});

const bookResultDto = (r: BookResult) =>
  'plan' in r ? { plan: planDto(r.plan) } : { sessions: r.sessions.map(bookedSessionDto) };

/** Audits a booking: a weekly plan as `plan.create` on the plan, a one-off as `booking.once` on the patient. */
const auditBooking = (req: Request, body: object) => (r: BookResult, session: mongoose.ClientSession) =>
  'plan' in r
    ? recordAudit(req, 'plan.create', 'plan', r.plan.id as string, body, session)
    : recordAudit(req, 'booking.once', 'patient', String(req.params.id), body, session);

scheduleRouter.post('/patients/:id/plan', requirePerm('schedule.book'), validate(bookBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof bookBody>;
    const result = await bookPlan(centreOf(req), String(req.params.id), b, auditBooking(req, b));
    res.status(201).json(bookResultDto(result));
  } catch (e) {
    next(e);
  }
});

scheduleRouter.put('/patients/:id/plan', requirePerm('schedule.book'), validate(changeBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof changeBody>;
    const plan = await changePlan(centreOf(req), String(req.params.id), b, (p, session) =>
      recordAudit(req, 'plan.change', 'plan', p.id as string, b, session),
    );
    res.json({ plan: planDto(plan) });
  } catch (e) {
    next(e);
  }
});

/**
 * Of a patient's plans still holding (`to` empty or ≥ today), the one in force today (`from ≤ today`), else the
 * next one to start.
 */
function planNow<T extends { from: string }>(plans: T[], today: string): T | undefined {
  const inForce = plans.filter((p) => p.from <= today).sort((a, b) => b.from.localeCompare(a.from));
  return inForce[0] ?? [...plans].sort((a, b) => a.from.localeCompare(b.from))[0];
}

/** The patient's plan in force today, else the next one to start, or null. */
scheduleRouter.get('/patients/:id/plan', requirePerm('schedule.view'), async (req, res, next) => {
  try {
    const patient = await loadPatientInCentre(centreOf(req), req.params.id);
    const today = todayLocal();
    const plans = await Plan.find({ patientId: patient._id, $or: [{ to: null }, { to: { $gte: today } }] });
    const plan = planNow(plans, today);
    res.json({ plan: plan ? planDto(plan) : null });
  } catch (e) {
    next(e);
  }
});

const freeQuery = z.object({ date: localDate, shiftId: z.string().min(1), patientId: z.string().min(1).optional() });

/** Machines free in a block on a date; with `patientId`, that patient's own holdings count as free. */
scheduleRouter.get('/schedule/free', requirePerm('schedule.view'), async (req, res, next) => {
  try {
    const centreId = centreOf(req);
    const parsed = freeQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('validation');
    const { date, shiftId, patientId } = parsed.data;
    const patient = patientId === undefined ? null : await loadPatientInCentre(centreId, patientId);
    res.json(await freeMachines(centreId, shiftId, date, patient ? { ignorePatientId: patient._id } : {}));
  } catch (e) {
    next(e);
  }
});

// ---------- calendar ----------

export const MAX_CALENDAR_DAYS = 14;
const calendarQuery = z.object({ from: localDate, to: localDate });
/** A non-live session that still shows on its cell: the patient's outcome for a held slot. */
const OUTCOME_STATUSES = ['missed', 'did_not_come'];

/**
 * Machines x blocks for each date in [from, to] (at most 14 days): the session on each cell, else the patient
 * whose weekly plan holds it (the slots.ts rules), and the rostered nurse per machine for each block.
 */
scheduleRouter.get('/schedule/calendar', requirePerm('schedule.view'), async (req, res, next) => {
  try {
    const centreId = centreOf(req);
    const q = calendarQuery.safeParse(req.query);
    if (!q.success) throw badRequest('validation');
    const { from, to } = q.data;
    if (to < from) throw badRequest('validation');
    const dates: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      dates.push(d);
      if (dates.length > MAX_CALENDAR_DAYS) throw badRequest('range_too_long');
    }
    const [centre, chairs, shifts] = await Promise.all([
      Centre.findById(centreId),
      Chair.find({ centreId, active: true }),
      Shift.find({ centreId, active: true }).sort({ start: 1 }),
    ]);
    if (!centre) throw notFound();
    chairs.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    const sessions = await Session.find({ centreId, date: { $gte: from, $lte: to }, shiftId: { $in: shifts.map((s) => s._id) } });
    const cards = new Map((await toSessionCards(centreId, sessions)).map(({ card }) => [card.id, card]));
    const byCell = new Map<string, SessionDoc[]>();
    for (const s of sessions) {
      const k = `${s.date}:${s.shiftId}:${s.chairId}`;
      byCell.set(k, [...(byCell.get(k) ?? []), s]);
    }
    const live = new Set<string>(LIVE_STATUSES);
    const days = [];
    for (const date of dates) {
      const working = centre.workingDays.includes(weekdayOf(date));
      if (!working) {
        days.push({ date, working, blocks: [] });
        continue;
      }
      const roster = await resolveRoster(centreId, date);
      const holds = new Map<string, Map<string, string>>();
      for (const sh of shifts) holds.set(sh.id as string, await planHolds(centreId, sh._id, date));
      const holderIds = [...holds.values()].flatMap((m) => [...m.values()]);
      const nurseIds = [...new Set(roster.values())];
      const [holderDocs, nurseDocs] = await Promise.all([
        Patient.find({ _id: { $in: holderIds } }),
        User.find({ _id: { $in: nurseIds } }),
      ]);
      const holderName = new Map(holderDocs.map((p) => [p.id as string, p.name]));
      const nurseName = new Map(nurseDocs.map((u) => [u.id as string, u.name]));
      const blocks = shifts.map((sh) => {
        const shiftId = sh.id as string;
        const nurseByChair: Record<string, { id: string; name: string } | null> = {};
        const cells = chairs.map((c) => {
          const chairId = c.id as string;
          const nid = roster.get(`${shiftId}:${chairId}`);
          nurseByChair[chairId] = nid ? { id: nid, name: nurseName.get(nid) ?? '' } : null;
          const here = byCell.get(`${date}:${shiftId}:${chairId}`) ?? [];
          const pick = here.find((s) => live.has(s.status)) ?? here.find((s) => OUTCOME_STATUSES.includes(s.status));
          const holder = holds.get(shiftId)!.get(chairId);
          const name = holder === undefined ? undefined : holderName.get(holder);
          return {
            chairId,
            session: pick ? (cards.get(pick.id as string) ?? null) : null,
            heldBy: !pick && holder !== undefined && name !== undefined ? { patientId: holder, name } : null,
          };
        });
        return { shiftId, nurseByChair, cells };
      });
      days.push({ date, working, blocks });
    }
    res.json({ days });
  } catch (e) {
    next(e);
  }
});

const boardQuery = z.object({ date: localDate.optional(), shiftId: z.string().min(1).optional() });

scheduleRouter.get('/board', requirePerm('sessions.view'), async (req, res, next) => {
  try {
    const parsed = boardQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('validation');
    res.json(await buildBoard(centreOf(req), String(req.user!._id), parsed.data));
  } catch (e) {
    next(e);
  }
});

const dischargeBody = z.object({ reason: z.enum(DISCHARGE_REASONS), date: localDate });

scheduleRouter.post(
  '/patients/:id/discharge',
  requirePerm('patients.discharge'),
  validate(dischargeBody),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof dischargeBody>;
      const patient = await loadPatientInCentre(centreOf(req), req.params.id);
      if (patient.status === 'transferring') throw conflict('transfer_pending');
      if (patient.status === 'discharged') throw conflict('already_discharged');
      await withTransaction(async (session) => {
        patient.status = 'discharged';
        patient.discharge = { reason: b.reason, date: b.date };
        await patient.save({ session });
        await endPlans(patient.id, b.date, session);
        await recordAudit(req, 'patient.discharge', 'patient', patient.id, b, session);
      });
      res.json({ id: patient.id as string, status: patient.status, discharge: { reason: b.reason, date: b.date } });
    } catch (e) {
      next(e);
    }
  },
);
