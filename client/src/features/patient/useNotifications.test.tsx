import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { useNotifications } from './useNotifications';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

function fakeSupport(permission: NotificationPermission, subscription: unknown = null) {
  const subscribe = vi.fn().mockResolvedValue({
    endpoint: 'https://push.example/abc',
    toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'P', auth: 'A' } }),
  });
  const reg = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription), subscribe } };
  Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(reg) }, configurable: true });
  vi.stubGlobal('PushManager', class {});
  const N = Object.assign(function () {}, { permission, requestPermission: vi.fn().mockResolvedValue('granted') });
  vi.stubGlobal('Notification', N);
  return { subscribe, N };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('useNotifications', () => {
  it('is hidden when the server has no public key', async () => {
    fakeSupport('default');
    server.use(http.get('*/api/push/key', () => HttpResponse.json({ publicKey: null })));
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('hidden'));
  });

  it('is denied (hint) when permission is denied', async () => {
    fakeSupport('denied');
    server.use(http.get('*/api/push/key', () => HttpResponse.json({ publicKey: 'AQAB' })));
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('denied'));
  });

  it('asks only on enable, then posts the subscription', async () => {
    const { subscribe, N } = fakeSupport('default');
    let posted: unknown;
    server.use(
      http.get('*/api/push/key', () => HttpResponse.json({ publicKey: 'AQAB' })),
      http.post('*/api/push/subscribe', async ({ request }) => {
        posted = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('off'));
    expect(N.requestPermission).not.toHaveBeenCalled();
    await act(() => result.current.enable());
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) });
    expect(posted).toEqual({ endpoint: 'https://push.example/abc', keys: { p256dh: 'P', auth: 'A' } });
    await waitFor(() => expect(result.current.status).toBe('on'));
  });

  it('shows on when already subscribed', async () => {
    fakeSupport('granted', { endpoint: 'x' });
    server.use(http.get('*/api/push/key', () => HttpResponse.json({ publicKey: 'AQAB' })));
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('on'));
  });
});
