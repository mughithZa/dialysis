import request from 'supertest';
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { seedRoles } from '../auth/roles.seed.js';
import { Centre } from '../centres/centre.model.js';
import { User } from '../auth/user.model.js';
import { localDateTime } from '../lib/dates.js';
import { Session } from '../sessions/session.model.js';
import { sendDueReminders } from './jobs.js';
import { PushSubscription } from './subscription.model.js';
import { getApp, login, makeCentre, makePatient, makeSession } from '../../test/factories.js';

beforeAll(async () => {
  await PushSubscription.init();
});
beforeEach(seedRoles);

type Sent = { userId: string; payload: { title: string; body: string; url: string } };

async function setup(reminderHours?: number, status = 'scheduled') {
  const { centre, chairs, shifts } = await makeCentre();
  if (reminderHours) await Centre.updateOne({ _id: centre._id }, { $set: { 'settings.reminderHours': reminderHours } });
  const { patient, user } = await makePatient(centre.id);
  const s = await makeSession({
    centreId: centre._id, patientId: patient._id, chairId: chairs[2]!._id, shiftId: shifts[0]!._id,
    date: '2026-10-19', status,
  });
  const sent: Sent[] = [];
  const send = async (userId: string, payload: Sent['payload']) => {
    sent.push({ userId, payload });
  };
  return { s, user, sent, send };
}
const at = (date: string, hhmm: string) => localDateTime(date, hhmm);

describe('sendDueReminders', () => {
  it('sends in Arabic to a patient who chose Arabic', async () => {
    const { user, sent, send } = await setup();
    await User.updateOne({ _id: user._id }, { $set: { language: 'ar' } });
    expect(await sendDueReminders(at('2026-10-18', '07:05'), send)).toBe(1);
    expect(sent[0]!.payload).toEqual({ title: 'جلسة غسيل الكلى', body: 'الاثنين 2026-10-19 الساعة 07:00، الكرسي 3', url: '/me' });
  });

  it('sends once inside the 24h window, not before', async () => {
    const { s, user, sent, send } = await setup();
    expect(await sendDueReminders(at('2026-10-18', '06:50'), send)).toBe(0);
    expect(await sendDueReminders(at('2026-10-18', '07:05'), send)).toBe(1);
    expect(sent).toEqual([
      { userId: String(user._id), payload: { title: 'Dialysis session', body: 'Monday 2026-10-19 at 07:00, chair 3', url: '/me' } },
    ]);
    expect((await Session.findById(s._id))!.reminderSentAt).toBeTruthy();
    expect(await sendDueReminders(at('2026-10-18', '07:15'), send)).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('uses the session snapshot (start time, machine label), not the live setup', async () => {
    const { s, sent, send } = await setup();
    await Session.updateOne({ _id: s._id }, { $set: { shiftStart: '08:00', chairLabel: 'B7' } });
    expect(await sendDueReminders(at('2026-10-18', '07:05'), send)).toBe(0);
    expect(await sendDueReminders(at('2026-10-18', '08:05'), send)).toBe(1);
    expect(sent[0]!.payload.body).toBe('Monday 2026-10-19 at 08:00, chair B7');
  });

  it('honours the centre reminderHours (15h -> due at 16:00 the day before)', async () => {
    const { sent, send } = await setup(15);
    expect(await sendDueReminders(at('2026-10-18', '15:50'), send)).toBe(0);
    expect(await sendDueReminders(at('2026-10-18', '16:05'), send)).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('does not send once the session has started', async () => {
    const { sent, send } = await setup();
    expect(await sendDueReminders(at('2026-10-19', '07:05'), send)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('never sends for a postponed session', async () => {
    const { sent, send } = await setup(undefined, 'postponed');
    expect(await sendDueReminders(at('2026-10-18', '08:00'), send)).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe('push routes', () => {
  const sub = (endpoint = 'https://push.example/abc') => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } });

  it('requires login', async () => {
    expect((await request(getApp()).post('/api/push/subscribe').send(sub())).status).toBe(401);
  });

  it('returns a null key when VAPID is not configured', async () => {
    const { centre } = await makeCentre();
    const { user } = await makePatient(centre.id);
    const agent = await login(user.username);
    const res = await agent.get('/api/push/key');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ publicKey: null });
  });

  it('subscribes (upsert, re-assigns user), validates and unsubscribes', async () => {
    const { centre } = await makeCentre();
    const a = await makePatient(centre.id);
    const b = await makePatient(centre.id);
    const agentA = await login(a.user.username);
    const agentB = await login(b.user.username);
    expect((await agentA.post('/api/push/subscribe').send(sub())).status).toBe(204);
    expect((await agentB.post('/api/push/subscribe').send(sub())).status).toBe(204);
    const docs = await PushSubscription.find();
    expect(docs).toHaveLength(1);
    expect(String(docs[0]!.userId)).toBe(String(b.user._id));
    const keys = { p256dh: 'p', auth: 'a' };
    for (const bad of [{ endpoint: 'http://x.example/a', keys }, { endpoint: 'https://x.example/a' }, { endpoint: 'nope', keys }]) {
      expect((await agentA.post('/api/push/subscribe').send(bad)).status).toBe(400);
    }
    expect((await agentB.post('/api/push/unsubscribe').send({ endpoint: sub().endpoint })).status).toBe(204);
    expect(await PushSubscription.countDocuments()).toBe(0);
  });
});
