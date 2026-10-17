import { User } from '../auth/user.model.js';
import { Order, type OrderDoc } from './order.model.js';

export interface OrderDto {
  id: string;
  text: string;
  from: string;
  status: 'active' | 'ended';
  doctor: { id: string; name: string };
  createdAt: Date;
}

export async function toOrderDtos(orders: OrderDoc[]): Promise<OrderDto[]> {
  const users = await User.find({ _id: { $in: orders.map((o) => o.doctorId) } });
  return orders.map((o) => ({
    id: o.id as string,
    text: o.text,
    from: o.from,
    status: o.status as 'active' | 'ended',
    doctor: { id: String(o.doctorId), name: users.find((u) => String(u._id) === String(o.doctorId))?.name ?? '' },
    createdAt: o.get('createdAt') as Date,
  }));
}

/** Orders in force for a patient on a local date: active and already started. */
export async function activeOrdersFor(patientId: unknown, date: string): Promise<OrderDto[]> {
  const orders = await Order.find({ patientId, status: 'active', from: { $lte: date } }).sort({ from: 1, _id: 1 });
  return toOrderDtos(orders);
}

/** Of the given (patient, date) pairs, the keys `${patientId}:${date}` that have an order in force. */
export async function withActiveOrders(pairs: { patientId: unknown; date: string }[]): Promise<Set<string>> {
  const ids = [...new Set(pairs.map((p) => String(p.patientId)))];
  const orders = await Order.find({ patientId: { $in: ids }, status: 'active' });
  const out = new Set<string>();
  for (const p of pairs) {
    if (orders.some((o) => String(o.patientId) === String(p.patientId) && o.from <= p.date)) out.add(`${p.patientId}:${p.date}`);
  }
  return out;
}
