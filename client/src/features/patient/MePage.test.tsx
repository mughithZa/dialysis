import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { addDaysLocal } from '../desk/dates';
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

  it('shows the next session at the top, and not while a session is active', async () => {
    server.use(
      http.get('*/api/me/overview', () => HttpResponse.json(overview({ upcoming: [mini('s2', '2027-10-19'), mini('s3', '2027-10-21')] }))),
      http.get('*/api/me/timeline', () => HttpResponse.json(timeline())),
    );
    renderApp(<MePage />);
    const next = await screen.findByRole('status', { name: 'Your next session' });
    expect(within(next).getByText('Tuesday, Oct 19')).toBeVisible();
    expect(within(next).getByText('07:00–11:00')).toBeVisible();
    expect(within(next).getByText('Damascus')).toBeVisible();
    expect(within(next).queryByText(/Machine/)).toBeNull(); // no label from an older server
  });

  it('names the machine, and says Today or Tomorrow for the next session', async () => {
    server.use(
      http.get('*/api/me/overview', () => HttpResponse.json(overview({ upcoming: [mini('s2', addDaysLocal(1), { chairLabel: '4' })] }))),
      http.get('*/api/me/timeline', () => HttpResponse.json(timeline())),
    );
    renderApp(<MePage />);
    const next = await screen.findByRole('status', { name: 'Your next session' });
    expect(within(next).getByText('Tomorrow')).toBeVisible();
    expect(within(next).getByText('Machine 4')).toBeVisible();
  });

  it('shows the active session as the hero card with its machine', async () => {
    server.use(
      http.get('*/api/me/overview', () => HttpResponse.json(overview({ active: mini('s1', '2026-10-18', { status: 'active', chairLabel: '2' }) }))),
      http.get('*/api/me/timeline', () => HttpResponse.json(timeline())),
    );
    renderApp(<MePage />);
    const hero = await screen.findByRole('status', { name: 'Session active now' });
    expect(hero).toHaveAttribute('data-hero', 'active');
    expect(within(hero).getByText('Machine 2')).toBeVisible();
    expect(within(hero).getByText('You are on the machine now.')).toBeVisible();
  });

  it('says when there is no upcoming session', async () => {
    server.use(
      http.get('*/api/me/overview', () => HttpResponse.json(overview())),
      http.get('*/api/me/timeline', () => HttpResponse.json(timeline())),
    );
    renderApp(<MePage />);
    expect(await screen.findByText('No upcoming sessions')).toBeVisible();
  });

  it('hides the next-session card while a session is active', async () => {
    server.use(
      http.get('*/api/me/overview', () =>
        HttpResponse.json(overview({ active: mini('s1', '2026-10-18', { status: 'active' }), upcoming: [mini('s2', '2026-10-20')] })),
      ),
      http.get('*/api/me/timeline', () => HttpResponse.json(timeline())),
    );
    renderApp(<MePage />);
    expect(await screen.findByText('Session active now')).toBeVisible();
    expect(screen.queryByText('Your next session')).not.toBeInTheDocument();
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

  it("shows the doctor's active orders once, in their own card, not on every session", async () => {
    const orders = [{ text: 'EPO 4000 IU every session', from: '2026-10-01' }];
    server.use(
      http.get('*/api/me/overview', () => HttpResponse.json(overview())),
      http.get('*/api/me/timeline', () =>
        HttpResponse.json(
          timeline({
            upcoming: [item('u1', '2027-10-20', { orders }), item('u2', '2027-10-22', { orders })],
            past: [item('a', '2026-10-15', { status: 'completed', orders })],
          }),
        ),
      ),
    );
    renderApp(<MePage />);
    const card = within(await screen.findByTestId('my-orders'));
    expect(card.getByRole('heading', { name: "Your doctor's instructions" })).toBeVisible();
    expect(card.getByText('From Oct 1, 2026')).toBeVisible();
    expect(screen.getAllByText('EPO 4000 IU every session')).toHaveLength(1);
  });

  it('has no orders card when there are no orders (or the centre keeps them private)', async () => {
    server.use(
      http.get('*/api/me/overview', () => HttpResponse.json(overview())),
      http.get('*/api/me/timeline', () => HttpResponse.json(timeline({ upcoming: [item('u1', '2027-10-20')] }))),
    );
    renderApp(<MePage />);
    expect(await screen.findByTestId('timeline-row-u1')).toBeVisible();
    expect(screen.queryByTestId('my-orders')).toBeNull();
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

  function fakePush(permission: NotificationPermission, subscription: unknown = null) {
    const reg = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription), subscribe: vi.fn() } };
    Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(reg) }, configurable: true });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', Object.assign(function () {}, { permission, requestPermission: vi.fn() }));
    server.use(
      http.get('*/api/me/overview', () => HttpResponse.json(overview())),
      http.get('*/api/me/timeline', () => HttpResponse.json(timeline())),
      http.get('*/api/push/key', () => HttpResponse.json({ publicKey: 'AQAB' })),
    );
  }

  it('offers a reminders card with a clear button when off', async () => {
    fakePush('default');
    renderApp(<MePage />);
    const card = within(await screen.findByTestId('reminders'));
    expect(card.getByText('Session reminders')).toBeVisible();
    expect(card.getByText('Get a reminder on your phone before each session.')).toBeVisible();
    expect(card.getByRole('button', { name: 'Turn on reminders' })).toBeVisible();
  });

  it('explains how to allow notifications when they are blocked', async () => {
    fakePush('denied');
    renderApp(<MePage />);
    const card = within(await screen.findByTestId('reminders'));
    expect(card.getByText('Reminders are blocked')).toBeVisible();
    expect(card.getByText(/set Notifications to Allow/)).toBeVisible();
    expect(card.queryByRole('button')).toBeNull();
  });

  it('says reminders are on once subscribed', async () => {
    fakePush('granted', { endpoint: 'https://p.example/x' });
    renderApp(<MePage />);
    const card = within(await screen.findByTestId('reminders'));
    expect(card.getByText('Notifications on')).toBeVisible();
    expect(card.queryByRole('button')).toBeNull();
  });

  it('shows nothing when the server has no push key', async () => {
    fakePush('default');
    server.use(http.get('*/api/push/key', () => HttpResponse.json({ publicKey: null })));
    renderApp(<MePage />);
    expect(await screen.findByText('Layla')).toBeVisible();
    await waitFor(() => expect(screen.queryByTestId('reminders')).toBeNull());
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
