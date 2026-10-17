import type { ClientSession } from 'mongoose';
import { withTransaction } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { UsageLine } from '../sessions/usage.model.js';
import { Item, type ItemDoc } from './item.model.js';

/** Flags an item as used (locks its unit). Called whenever a usage line is recorded. */
export async function markItemUsed(itemId: string, session?: ClientSession): Promise<void> {
  await Item.updateOne({ _id: itemId }, { $set: { used: true } }, { session });
}

/**
 * Merges `fromId` into `intoId` atomically: usage lines are re-pointed and the source is retired.
 * Both items must share a unit; neither may already be retired.
 */
export async function mergeItems(fromId: string, intoId: string): Promise<{ from: ItemDoc; into: ItemDoc }> {
  if (fromId === intoId) throw badRequest('same_item');
  return withTransaction(async (session) => {
    const from = await Item.findById(fromId).session(session);
    const into = await Item.findById(intoId).session(session);
    if (!from || !into) throw notFound();
    if (from.status === 'retired' || into.status === 'retired') throw conflict('item_retired');
    if (String(from.unitId) !== String(into.unitId)) throw badRequest('unit_mismatch');
    await UsageLine.updateMany({ itemId: from._id }, { $set: { itemId: into._id } }, { session });
    if (from.used) into.used = true;
    from.status = 'retired';
    from.mergedInto = into._id;
    await from.save({ session });
    await into.save({ session });
    return { from, into };
  });
}
