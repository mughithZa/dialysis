import type { Types } from 'mongoose';
import { Centre } from '../centres/centre.model.js';
import { Item } from '../catalog/item.model.js';
import { Unit } from '../catalog/unit.model.js';
import { monthRange } from '../lib/dates.js';
import { Session } from '../sessions/session.model.js';
import { UsageLine } from '../sessions/usage.model.js';

export interface ItemTotal {
  item: { id: string; name: string };
  unit: string;
  total: number;
}
export interface CentreStats {
  centre: { id: string; name: string };
  sessions: number;
  patients: number;
  medicines: ItemTotal[];
  supplies: ItemTotal[];
}

/** Follows `mergedInto` links to the surviving item (defensive: merge already re-points usage). */
function resolver(items: Map<string, { mergedInto?: Types.ObjectId | null }>) {
  return (id: string): string => {
    let cur = id;
    for (let i = 0; i < 20; i++) {
      const next = items.get(cur)?.mergedInto;
      if (!next) break;
      cur = String(next);
    }
    return cur;
  };
}

/**
 * Per-centre month aggregates, counted by the session's own centre (a transferred patient's
 * past sessions stay with the centre where they took place). Only completed sessions count.
 */
export async function centreStats(centreIds: Types.ObjectId[], month: string): Promise<CentreStats[]> {
  const { from, to } = monthRange(month);
  const dateIn = { $gte: from, $lte: to };
  const [centres, sessionRows, usageRows] = await Promise.all([
    Centre.find({ _id: { $in: centreIds } }).sort({ name: 1 }),
    Session.aggregate<{ _id: Types.ObjectId; sessions: number; patients: number }>([
      { $match: { centreId: { $in: centreIds }, date: dateIn, status: 'completed' } },
      { $group: { _id: '$centreId', sessions: { $sum: 1 }, patientSet: { $addToSet: '$patientId' } } },
      { $project: { sessions: 1, patients: { $size: '$patientSet' } } },
    ]),
    UsageLine.aggregate<{ _id: { centreId: Types.ObjectId; itemId: Types.ObjectId }; total: number }>([
      { $match: { centreId: { $in: centreIds }, date: dateIn } },
      {
        $lookup: {
          from: Session.collection.name,
          localField: 'sessionId',
          foreignField: '_id',
          pipeline: [{ $match: { status: 'completed' } }, { $project: { _id: 1 } }],
          as: 'completed',
        },
      },
      { $match: { 'completed.0': { $exists: true } } },
      { $group: { _id: { centreId: '$centreId', itemId: '$itemId' }, total: { $sum: '$amount' } } },
    ]),
  ]);

  const items = new Map((await Item.find()).map((i) => [i.id as string, i]));
  const units = new Map((await Unit.find()).map((u) => [u.id as string, u.name]));
  const resolve = resolver(items);

  return centres.map((c) => {
    const cid = c.id as string;
    const s = sessionRows.find((r) => String(r._id) === cid);
    const totals = new Map<string, number>();
    for (const r of usageRows) {
      if (String(r._id.centreId) !== cid) continue;
      const key = resolve(String(r._id.itemId));
      totals.set(key, (totals.get(key) ?? 0) + r.total);
    }
    const list = (type: 'medicine' | 'supply'): ItemTotal[] =>
      [...totals]
        .flatMap(([id, total]) => {
          const it = items.get(id);
          return it && it.type === type
            ? [{ item: { id, name: it.name }, unit: units.get(String(it.unitId)) ?? '', total }]
            : [];
        })
        .sort((a, b) => a.item.name.localeCompare(b.item.name));
    return {
      centre: { id: cid, name: c.name },
      sessions: s?.sessions ?? 0,
      patients: s?.patients ?? 0,
      medicines: list('medicine'),
      supplies: list('supply'),
    };
  });
}
