import webpush from 'web-push';
import { config } from '../config.js';
import { PushSubscription } from './subscription.model.js';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export const vapidConfigured = () => Boolean(config.vapidPublic && config.vapidPrivate);

let initialised = false;
let warned = false;

function init(): boolean {
  if (!vapidConfigured()) {
    if (!warned) {
      warned = true;
      console.warn('VAPID keys not configured: push notifications are disabled');
    }
    return false;
  }
  if (!initialised) {
    webpush.setVapidDetails(config.vapidSubject, config.vapidPublic, config.vapidPrivate);
    initialised = true;
  }
  return true;
}

/** Sends a push to every subscription of the user; drops subscriptions the push service reports gone. */
export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  if (!init()) return;
  const subs = await PushSubscription.find({ userId });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.keys!.p256dh, auth: s.keys!.auth } },
          JSON.stringify(payload),
        );
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await PushSubscription.deleteOne({ _id: s._id });
        else console.error('push failed', e);
      }
    }),
  );
}
