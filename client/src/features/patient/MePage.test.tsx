import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MePage } from './MePage';
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
  upcoming: [],
  ...over,
});

const item = (id: string, date: string, over: Record<string, unknown> = {}) => ({
  id,
  date,
  start: '07:00',
  end: '11:00',
  block: 'Morning',
  chairLabel: '3',
  centreId: 'c1',
  centreName: 'Damascus',
  status: 'scheduled',
  kind: 'regular',
  detached: false,
  oneOff: false,
  nurse: null,
  medicines: [],
  ...over,
});

const timeline = (over: Record<string, unknown> = {}) => ({ upcoming: [], today: [], past: [], notes: [], ...over });

describe('MePage', () => {
  it('shows the active banner with weekday and times', async () => {
    server.use(
      http.get('*/api/me/overview', () => HttpResponse.json(overview({ active: mini('s1', '2026-10-18', { status: 'active' }) }))),
      http.get('*/api/me/timeline', () => HttpResponse.json(timeline())),
    );
    renderApp(<MePage />);
    expect(await screen.findByText('Session active now')).toBeVisible();
    expect(screen.getByText(/Sunday/)).toBeVisible();
    expect(screen.getAllByText(/07:00/).length).toBeGreaterThan(0);
  });

  it('has no banner without an active session', async () => {
    server.use(
      http.get('*/api/me/overview', () => HttpResponse.json(overview())),
      http.get('*/api/me/timeline', () => HttpResponse.json(timeline({ upcoming: [item('s2', '2026-10-20')] }))),
    );
    renderApp(<MePage />);
    expect(await screen.findByText(/Tuesday/)).toBeVisible();
    expect(screen.queryByText('Session active now')).not.toBeInTheDocument();
  });

  it('shows the shared timeline: sessions with medicines, and notes only when the server sends them', async () => {
    server.use(
      http.get('*/api/me/overview', () => HttpResponse.json(overview())),
      http.get('*/api/me/timeline', () =>
        HttpResponse.json(
          timeline({
            past: [item('a', '2026-10-15', { status: 'completed', medicines: [{ name: 'Heparin', amount: 5, unit: 'ml' }] })],
            notes: [{ id: 'n1', at: new Date(2026, 9, 15, 9, 0).toISOString(), text: 'Felt dizzy', author: { name: 'Dr Omar' } }],
          }),
        ),
      ),
    );
    renderApp(<MePage />);
    expect(await screen.findByText(/Heparin: 5 ml/)).toBeVisible();
    expect(screen.getByText('Felt dizzy')).toBeVisible();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Past' })).toBeVisible();
  });

  it('shows no notes when the centre keeps them private', async () => {
    server.use(
      http.get('*/api/me/overview', () => HttpResponse.json(overview())),
      http.get('*/api/me/timeline', () => HttpResponse.json(timeline({ past: [item('a', '2026-10-15', { status: 'completed' })] }))),
    );
    renderApp(<MePage />);
    expect(await screen.findByTestId('timeline-row-a')).toBeVisible();
    expect(screen.queryByText('Doctor note')).toBeNull();
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
      http.get('*/api/me/timeline', () => HttpResponse.json(timeline())),
      http.get('*/api/push/key', () => HttpResponse.json({ publicKey: 'AQAB' })),
      http.post('*/api/push/subscribe', () => HttpResponse.json({ error: 'generic' }, { status: 500 })),
    );
    renderApp(<MePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on reminders' }));
    expect(await screen.findByText('Could not turn on notifications.')).toBeVisible();
  });
});
