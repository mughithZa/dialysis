import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { renderApp } from '../test/render';
import { useAuth } from './AuthProvider';

function LogoutButton() {
  const { me, logout } = useAuth();
  return (
    <button type="button" onClick={() => void logout().catch(() => {})}>
      {me ? `out ${me.name}` : 'signed out'}
    </button>
  );
}

function fakePush(subscription: unknown) {
  const reg = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { getRegistration: vi.fn().mockResolvedValue(reg) },
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

const signedIn = http.get('*/api/auth/me', () =>
  HttpResponse.json({ id: 'p', name: 'Pat', kind: 'patient', globalPermissions: [], centres: [] }),
);

describe('logout', () => {
  it('drops the push subscription (server, then browser) before logging out', async () => {
    const calls: string[] = [];
    const unsubscribe = vi.fn(async () => {
      calls.push('browser-unsubscribe');
      return true;
    });
    fakePush({ endpoint: 'https://push.example/abc', unsubscribe });
    server.use(
      signedIn,
      http.post('*/api/push/unsubscribe', async ({ request }) => {
        calls.push(`server-unsubscribe ${JSON.stringify(await request.json())}`);
        return new HttpResponse(null, { status: 204 });
      }),
      http.post('*/api/auth/logout', () => {
        calls.push('logout');
        return HttpResponse.json({ ok: true });
      }),
    );
    renderApp(<LogoutButton />);
    await userEvent.click(await screen.findByRole('button', { name: 'out Pat' }));
    await screen.findByRole('button', { name: 'signed out' });
    expect(calls).toEqual(['server-unsubscribe {"endpoint":"https://push.example/abc"}', 'browser-unsubscribe', 'logout']);
  });

  it('still logs out when unsubscribing fails', async () => {
    const calls: string[] = [];
    fakePush({ endpoint: 'e', unsubscribe: vi.fn().mockRejectedValue(new Error('nope')) });
    server.use(
      signedIn,
      http.post('*/api/push/unsubscribe', () => HttpResponse.json({ error: 'internal' }, { status: 500 })),
      http.post('*/api/auth/logout', () => {
        calls.push('logout');
        return HttpResponse.json({ ok: true });
      }),
    );
    renderApp(<LogoutButton />);
    await userEvent.click(await screen.findByRole('button', { name: 'out Pat' }));
    await waitFor(() => expect(calls).toEqual(['logout']));
  });
});
