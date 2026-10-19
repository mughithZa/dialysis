import { Types } from 'mongoose';
import { Centre } from '../centres/centre.model.js';
import { Chair } from '../centres/chair.model.js';
import { Shift } from '../centres/shift.model.js';
import { Session, LIVE_STATUSES } from '../sessions/session.model.js';
import { toSessionCards, type SessionCard } from '../sessions/card.js';
import { localDateTime, todayLocal, weekdayOf } from '../lib/dates.js';
import { notFound } from '../lib/errors.js';

export type BoardRow = SessionCard & { mine: boolean };

export interface BoardDto {
  date: string;
  working: boolean;
  blocks: { id: string; name: string; start: string; end: string }[];
  shiftId: string | null;
  active: BoardRow[];
  waiting: BoardRow[];
  done: BoardRow[];
  didNotCome: BoardRow[];
  /** postponed, cancelled, missed */
  other: BoardRow[];
  emptyMachines: { id: string; label: string }[];
  /** Sessions still active from an earlier day (opened, never closed), oldest first, whatever date or block is shown. */
  unclosed: BoardRow[];
}

/** How many unclosed sessions the board lists at most. */
export const UNCLOSED_LIMIT = 50;

const byLabel = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * The Today board for one block on one date. Default block: on today, the one running now, else the next one
 * today, else the last; on any other date, the first.
 */
export async function buildBoard(
  centreId: string,
  viewerUserId: string,
  { date, shiftId, now = new Date() }: { date?: string; shiftId?: string; now?: Date } = {},
): Promise<BoardDto> {
  const day = date ?? todayLocal(now);
  const [centre, shifts] = await Promise.all([
    Centre.findById(centreId),
    Shift.find({ centreId, active: true }).sort({ start: 1 }),
  ]);
  if (!centre) throw notFound();
  const blocks = shifts.map((s) => ({ id: s.id as string, name: s.name, start: s.start, end: s.end }));

  let chosen: string | null;
  if (shiftId !== undefined) {
    if (!blocks.some((b) => b.id === shiftId)) throw notFound();
    chosen = shiftId;
  } else if (day !== todayLocal(now)) {
    chosen = blocks[0]?.id ?? null;
  } else {
    const t = now.getTime();
    const running = blocks.find((b) => localDateTime(day, b.start).getTime() <= t && t < localDateTime(day, b.end).getTime());
    const next = blocks.find((b) => localDateTime(day, b.start).getTime() > t);
    chosen = (running ?? next ?? blocks[blocks.length - 1])?.id ?? null;
  }

  const working = centre.workingDays.includes(weekdayOf(day));
  const stale = await Session.find({ centreId, status: 'active', date: { $lt: todayLocal(now) } })
    .sort({ date: 1, shiftStart: 1, _id: 1 })
    .limit(UNCLOSED_LIMIT);
  const unclosed = (await toSessionCards(centreId, stale)).map(({ card }) => ({
    ...card,
    mine: card.nurse?.id === viewerUserId || card.runBy?.id === viewerUserId,
  }));
  const out: BoardDto = {
    date: day,
    working,
    blocks,
    shiftId: chosen,
    active: [],
    waiting: [],
    done: [],
    didNotCome: [],
    other: [],
    emptyMachines: [],
    unclosed,
  };
  if (!working || chosen === null) return out;

  const [sessions, chairs] = await Promise.all([
    Session.find({ centreId, date: day, shiftId: new Types.ObjectId(chosen) }),
    Chair.find({ centreId, active: true }),
  ]);
  const cards = (await toSessionCards(centreId, sessions)).map(({ card }) => ({
    ...card,
    mine: card.nurse?.id === viewerUserId || card.runBy?.id === viewerUserId,
  }));
  cards.sort((a, b) => byLabel(a.chairLabel, b.chairLabel));
  const group: Record<string, BoardRow[]> = {
    active: out.active,
    scheduled: out.waiting,
    completed: out.done,
    did_not_come: out.didNotCome,
  };
  for (const row of cards) (group[row.status] ?? out.other).push(row);

  const live = new Set<string>(LIVE_STATUSES);
  const taken = new Set(cards.filter((r) => live.has(r.status)).map((r) => r.chair.id));
  out.emptyMachines = chairs
    .filter((c) => !taken.has(c.id as string))
    .map((c) => ({ id: c.id as string, label: c.label }))
    .sort((a, b) => byLabel(a.label, b.label));
  return out;
}
