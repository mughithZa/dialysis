import { Item as CatalogItem } from '../catalog/item.model.js';
import { Unit } from '../catalog/unit.model.js';
import { User } from '../auth/user.model.js';
import { Centre } from '../centres/centre.model.js';
import { Shift } from '../centres/shift.model.js';
import { addDays, localDateTime, todayLocal } from '../lib/dates.js';
import { PatientNote } from '../notes/patient-note.model.js';
import { Order } from '../orders/order.model.js';
import { toNoteItems, type NoteItem } from '../notes/service.js';
import { resolveRoster } from '../schedule/roster.js';
import { Session, type SessionDoc } from './session.model.js';
import { UsageLine } from './usage.model.js';

export type TimelineViewer = { kind: 'staff'; centreId: string } | { kind: 'patient'; seeNotes: boolean };

export interface TimelineItem {
  id: string;
  date: string;
  start: string;
  end: string;
  block: string;
  chairLabel: string;
  centreId: string;
  centreName: string;
  status: string;
  kind: string;
  detached: boolean;
  oneOff: boolean;
  nurse: { name: string } | null;
  medicines: { name: string; amount: number; unit: string }[];
  statusReason?: string;
  /** Staff viewers only. */
  linkable?: boolean;
  /** Patient viewers whose centre shares notes only: the session's nurse notes (no staff ids). */
  notes?: { at: Date; text: string }[];
  /** Patient viewers whose centre shares notes only: doctor orders in force on the session's date. */
  orders?: { text: string; from: string }[];
}

export interface Timeline {
  upcoming: TimelineItem[];
  today: TimelineItem[];
  past: TimelineItem[];
  notes: NoteItem[];
}

const NOTE_DAYS = 30;

async function toItems(sessions: SessionDoc[], viewer: TimelineViewer, today: string): Promise<TimelineItem[]> {
  if (sessions.length === 0) return [];
  const [shifts, centres, lines] = await Promise.all([
    Shift.find({ _id: { $in: sessions.map((s) => s.shiftId) } }),
    Centre.find({ _id: { $in: sessions.map((s) => s.centreId) } }),
    UsageLine.find({ sessionId: { $in: sessions.map((s) => s._id) } }).sort({ createdAt: 1 }),
  ]);
  const catalog = await CatalogItem.find({ _id: { $in: lines.map((l) => l.itemId) } });
  const units = await Unit.find({ _id: { $in: catalog.map((i) => i.unitId) } });

  // roster fallback only for sessions that have not happened yet and carry no frozen nurse
  const rosters = new Map<string, Map<string, string>>();
  const needRoster = (s: SessionDoc) => !s.runBy && !s.rosterNurseId && s.date >= today && s.status === 'scheduled';
  for (const s of sessions.filter(needRoster)) {
    const key = `${s.centreId}:${s.date}`;
    if (!rosters.has(key)) rosters.set(key, await resolveRoster(String(s.centreId), s.date));
  }
  const nurseIdOf = (s: SessionDoc): string | undefined =>
    (s.runBy ? String(s.runBy) : undefined) ??
    (s.rosterNurseId ? String(s.rosterNurseId) : undefined) ??
    (needRoster(s) ? rosters.get(`${s.centreId}:${s.date}`)?.get(`${s.shiftId}:${s.chairId}`) : undefined);
  const users = await User.find({ _id: { $in: sessions.map(nurseIdOf).filter((x): x is string => !!x) } });
  const shareNotes = viewer.kind === 'patient' && viewer.seeNotes;
  const orders = shareNotes
    ? await Order.find({ patientId: { $in: [...new Set(sessions.map((s) => String(s.patientId)))] }, status: 'active' }).sort({ from: 1, _id: 1 })
    : [];

  return sessions.map((s) => {
    const nid = nurseIdOf(s);
    const item: TimelineItem = {
      id: s.id as string,
      date: s.date,
      start: s.shiftStart,
      end: s.shiftEnd,
      block: shifts.find((x) => String(x._id) === String(s.shiftId))?.name ?? '',
      chairLabel: s.chairLabel,
      centreId: String(s.centreId),
      centreName: centres.find((c) => String(c._id) === String(s.centreId))?.name ?? '',
      status: s.status,
      kind: s.kind,
      detached: s.detached === true,
      oneOff: s.oneOff === true,
      nurse: nid ? { name: users.find((u) => String(u._id) === nid)?.name ?? '' } : null,
      medicines: lines
        .filter((l) => String(l.sessionId) === String(s._id))
        .flatMap((l) => {
          const it = catalog.find((i) => String(i._id) === String(l.itemId));
          if (!it || it.type !== 'medicine') return [];
          return [{ name: it.name, amount: l.amount, unit: units.find((u) => String(u._id) === String(it.unitId))?.name ?? '' }];
        }),
    };
    if (s.statusReason) item.statusReason = s.statusReason;
    if (viewer.kind === 'staff') item.linkable = item.centreId === viewer.centreId;
    if (shareNotes) {
      item.notes = s.notes.map((n) => ({ at: n.at, text: n.text }));
      item.orders = orders
        .filter((o) => String(o.patientId) === String(s.patientId) && o.from <= s.date)
        .map((o) => ({ text: o.text, from: o.from }));
    }
    return item;
  });
}

const asc = (a: TimelineItem, b: TimelineItem) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start);

/** The one timeline builder, shared by the staff patient page and the patient's own app. */
export async function buildTimeline(
  patientId: unknown,
  viewer: TimelineViewer,
  opts: { before?: string; limit?: number } = {},
): Promise<Timeline> {
  const limit = opts.limit ?? 20;
  const today = todayLocal();
  const first = !opts.before;

  const [upcomingDocs, todayDocs, pastDocs] = await Promise.all([
    first ? Session.find({ patientId, status: 'scheduled', date: { $gte: addDays(today, 1), $lte: addDays(today, 13) } }) : [],
    first ? Session.find({ patientId, date: today }) : [],
    // newest first; one extra row tells whether older history remains
    Session.find({ patientId, date: { $lt: opts.before && opts.before < today ? opts.before : today } })
      .sort({ date: -1, shiftStart: -1, _id: -1 })
      .limit(limit + 1),
  ]);
  const [pastAll, upcoming, todayItems] = await Promise.all([
    toItems(pastDocs, viewer, today),
    toItems(upcomingDocs, viewer, today),
    toItems(todayDocs, viewer, today),
  ]);
  pastAll.sort((a, b) => asc(b, a));
  const past = pastAll.slice(0, limit);
  upcoming.sort(asc);
  todayItems.sort(asc);

  let notes: NoteItem[] = [];
  if (viewer.kind === 'staff' || viewer.seeNotes) {
    // the page's date span: from its oldest shown date (open when it is the last page) up to `before` (open on the first page);
    // the first page also reaches back NOTE_DAYS so recent notes always show
    const oldest = pastAll.length > limit ? past[past.length - 1]!.date : undefined;
    let lower = oldest;
    if (first) {
      const recent = addDays(today, -NOTE_DAYS);
      lower = oldest && oldest < recent ? oldest : oldest ? recent : undefined;
    }
    const at: Record<string, Date> = {};
    if (lower) at.$gte = localDateTime(lower, '00:00');
    if (opts.before) at.$lt = localDateTime(opts.before, '00:00');
    notes = await toNoteItems(await PatientNote.find({ patientId, ...(Object.keys(at).length ? { at } : {}) }).sort({ at: -1, _id: -1 }));
  }
  return { upcoming, today: todayItems, past, notes };
}
