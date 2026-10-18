import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../api';

export type NotificationStatus = 'loading' | 'hidden' | 'denied' | 'off' | 'on';

/** Web Push wants the VAPID key as bytes; the server sends it base64url. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const supported = () =>
  typeof Notification !== 'undefined' && typeof PushManager !== 'undefined' && 'serviceWorker' in navigator;

/**
 * Push opt-in. `hidden` = nothing to show (unsupported or server push not configured);
 * `denied` = blocked in the browser (show a hint); `off`/`on` = the toggle states.
 * Permission is requested only inside `enable()`, which the caller wires to a button.
 */
export function useNotifications() {
  const canUse = supported();
  const key = useQuery({
    queryKey: ['push', 'key'],
    queryFn: () => apiGet<{ publicKey: string | null }>('/push/key'),
    enabled: canUse,
    staleTime: Infinity,
  });
  const publicKey = key.data?.publicKey ?? null;
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!canUse || !publicKey) return;
    if (Notification.permission === 'denied') setBlocked(true);
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => !cancelled && setSubscribed(sub !== null))
      .catch(() => !cancelled && setSubscribed(false));
    return () => {
      cancelled = true;
    };
  }, [canUse, publicKey]);

  const enable = useCallback(async () => {
    if (!publicKey) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setBlocked(permission === 'denied');
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const { endpoint, keys } = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await apiPost('/push/subscribe', { endpoint, keys });
    setSubscribed(true);
  }, [publicKey]);

  let status: NotificationStatus;
  if (!canUse) status = 'hidden';
  else if (key.isPending) status = 'loading';
  else if (!publicKey) status = 'hidden';
  else if (blocked) status = 'denied';
  else if (subscribed === null) status = 'loading';
  else status = subscribed ? 'on' : 'off';

  return { status, enable };
}
