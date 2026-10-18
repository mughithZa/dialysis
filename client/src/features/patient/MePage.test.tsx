import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MePage } from './MePage';
import { HistoryPage } from './HistoryPage';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

const mini = (id: string, date: string, over: Record<string, unknown> = {}) => ({
  id,
  date,
  start: '07:00',
  end: '11:00',
  centreName: 'Damascus',
  kind: 'regular',
  status: 'scheduled',
  ...over,
});

const overview = (over: Record<string, unknown> = {}) => ({
  patient: { name: 'Layla' },
  centre: { name: 'Damascus' },
  active: null,
  upcoming: [mini('s2', '2026-10-20')],
  ...over,
});

describe('MePage', () => {
  it('shows the active banner and upcoming sessions with weekday and times', async () => {
    server.use(
      http.get('*/api/me/overview', () =>
        HttpResponse.json(overview({ active: mini('s1', '2026-10-18', { status: 'active' }) })),
      ),
    );
    renderApp(<MePage />);
    expect(await screen.findByText('Session active now')).toBeVisible();
    expect(screen.getByText(/Tuesday/)).toBeVisible();
    expect(screen.getAllByText(/07:00/).length).toBeGreaterThan(0);
  });

  it('has no banner without an active session', async () => {
    server.use(http.get('*/api/me/overview', () => HttpResponse.json(overview())));
    renderApp(<MePage />);
    expect(await screen.findByText(/Tuesday/)).toBeVisible();
    expect(screen.queryByText('Session active now')).not.toBeInTheDocument();
  });
});

describe('HistoryPage', () => {
  const row = (id: string, date: string, over: Record<string, unknown> = {}) => ({
    ...mini(id, date, { status: 'completed' }),
    usage: [{ name: 'Heparin', amount: 5, unit: 'ml' }],
    ...over,
  });

  it('hides notes and orders when the keys are absent', async () => {
    server.use(http.get('*/api/me/sessions', () => HttpResponse.json([row('a', '2026-10-15')])));
    renderApp(<HistoryPage />);
    expect(await screen.findByText(/Heparin/)).toBeVisible();
    expect(screen.getByText(/5 ml/)).toBeVisible();
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
    expect(screen.queryByText('Orders')).not.toBeInTheDocument();
  });

  it('shows notes and orders when returned', async () => {
    server.use(
      http.get('*/api/me/sessions', () =>
        HttpResponse.json([
          row('a', '2026-10-15', { notes: [{ at: '2026-10-15T08:00:00Z', text: 'Felt dizzy' }], orders: [{ text: 'Drink less', from: '2026-10-01' }] }),
        ]),
      ),
    );
    renderApp(<HistoryPage />);
    expect(await screen.findByText('Felt dizzy')).toBeVisible();
    expect(screen.getByText('Drink less')).toBeVisible();
  });

  it('loads more using the last date as before', async () => {
    const befores: Array<string | null> = [];
    server.use(
      http.get('*/api/me/sessions', ({ request }) => {
        const before = new URL(request.url).searchParams.get('before');
        befores.push(before);
        return HttpResponse.json(
          before
            ? [row('b', '2026-10-01')]
            : Array.from({ length: 20 }, (_, i) => row(`r${i}`, `2026-10-${String(30 - i).padStart(2, '0')}`)),
        );
      }),
    );
    renderApp(<HistoryPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText("Thursday, Oct 1")).toBeVisible();
    expect(befores[1]).toBe('2026-10-11');
  });
});

describe('MePage reminders', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('shows a hint when turning on notifications fails', async () => {
    const reg = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockResolvedValue({ toJSON: () => ({ endpoint: 'https://p.example/x', keys: { p256dh: 'P', auth: 'A' } }) }),
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(reg) }, configurable: true });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') }));
    server.use(
      http.get('*/api/me/overview', () => HttpResponse.json(overview())),
      http.get('*/api/push/key', () => HttpResponse.json({ publicKey: 'AQAB' })),
      http.post('*/api/push/subscribe', () => HttpResponse.json({ error: 'generic' }, { status: 500 })),
    );
    renderApp(<MePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on reminders' }));
    expect(await screen.findByText('Could not turn on notifications.')).toBeVisible();
  });
});
