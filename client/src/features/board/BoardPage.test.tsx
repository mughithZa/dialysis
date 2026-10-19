import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { BoardPage } from './BoardPage';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';
import { todayLocal } from '../desk/dates';

const row = (id: string, patient: string, chair: string, status: string, over: Record<string, unknown> = {}) => ({
  id,
  date: todayLocal(),
  status,
  kind: 'regular',
  chair: { id: `c${id}`, label: chair },
  chairLabel: chair,
  shift: { id: 'sh1', name: 'Morning', start: '07:00', end: '11:00' },
  start: '07:00',
  end: '11:00',
  patient: { id: `p${id}`, name: patient },
  hasActiveOrders: false,
  nurse: { id: 'n1', name: 'Huda' },
  runBy: null,
  mine: false,
  openedAt: null,
  closedAt: null,
  ...over,
});

const empty = {
  date: todayLocal(),
  working: true,
  blocks: [
    { id: 'sh1', name: 'Morning', start: '07:00', end: '11:00' },
    { id: 'sh2', name: 'Afternoon', start: '12:00', end: '16:00' },
  ],
  shiftId: 'sh1',
  active: [],
  waiting: [],
  done: [],
  didNotCome: [],
  other: [],
  emptyMachines: [],
  unclosed: [],
};

function mount(perms: string[], board: Record<string, unknown>) {
  useCentreUser(perms);
  server.use(http.get('*/api/centres/c1/board', () => HttpResponse.json({ ...empty, ...board })));
  return renderApp(
    <Routes>
      <Route path="/c/:centreId/today" element={<BoardPage />} />
    </Routes>,
    '/c/c1/today',
  );
}

const FRONT = ['sessions.view', 'sessions.run', 'sessions.postpone', 'schedule.book', 'schedule.makeup'];
const NURSE = ['sessions.view', 'sessions.run', 'sessions.postpone'];

describe('BoardPage', () => {
  const FULL = {
    active: [row('1', 'Layla', '1', 'active', { hasActiveOrders: true })],
    waiting: [row('2', 'Omar', '2', 'scheduled')],
    done: [row('3', 'Huda P', '3', 'completed')],
    didNotCome: [row('4', 'Sami', '4', 'did_not_come')],
    other: [row('5', 'Rana', '5', 'postponed')],
    emptyMachines: [
      { id: 'c4', label: '4' },
      { id: 'c5', label: '5' },
      { id: 'm6', label: '6' },
      { id: 'm10', label: '10' },
    ],
  };

  it('renders blocks, stat cards, the Active and Waiting groups', async () => {
    mount(FRONT, FULL);
    expect(await screen.findByRole('link', { name: 'Layla' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Morning' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Afternoon' })).toBeInTheDocument();
    expect(screen.getByText('Active now (1)')).toBeInTheDocument();
    expect(screen.getByText('Waiting (1)')).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Omar' })).toBeInTheDocument();
    const stat = (label: string) => screen.getByText(label, { selector: '[data-stat-card] p' }).previousElementSibling?.textContent;
    expect(stat('Active')).toBe('1');
    expect(stat('Waiting')).toBe('1');
    expect(stat('Done')).toBe('1');
    expect(stat('Free machines')).toBe('4');
    expect(screen.getAllByRole('link', { name: 'Open' })[0]).toHaveAttribute('href', '/c/c1/sessions/1');
  });

  it('draws one tile per machine, in machine order, coloured by state, with a legend', async () => {
    mount(FRONT, FULL);
    const grid = await screen.findByRole('list', { name: 'Machines in this block' });
    const tiles = within(grid).getAllByRole('listitem').map((li) => li.firstElementChild as HTMLElement);
    // machines 4 and 5 have only a dead session (did not come, postponed): they show that, not "free"
    expect(tiles.map((el) => [el.textContent, el.dataset.tileState])).toEqual([
      ['1Layla', 'active'],
      ['2Omar', 'waiting'],
      ['3Huda P', 'completed'],
      ['4Sami', 'did_not_come'],
      ['5Rana', 'postponed'],
      ['6Free', 'free'],
      ['10Free', 'free'],
    ]);
    expect(within(grid).getByRole('link', { name: 'Machine 1: Layla, Active' })).toHaveAttribute('href', '/c/c1/sessions/1');
    expect(within(grid).getByRole('link', { name: 'Machine 4: Sami, Did not come' })).toHaveAttribute('href', '/c/c1/sessions/4');
    // free tiles are not links: tapping them does nothing
    expect(within(grid).getAllByRole('link')).toHaveLength(5);
    expect(tiles[5]!.tagName).toBe('DIV');
    expect(tiles[5]).toHaveAttribute('aria-label', 'Machine 6: free');
    // each state has its own colour
    const bg = (i: number) => tiles[i]!.style.getPropertyValue('--tile-bg');
    expect(new Set([0, 1, 2, 3, 4].map(bg)).size).toBe(5);
    for (const text of ['Active 1', 'Waiting 1', 'Done 1', 'Did not come 1', 'Postponed or cancelled 1', 'Free 2']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it('a machine shows its live session over a dead one on the same machine', async () => {
    mount(FRONT, {
      waiting: [row('2', 'Omar', '1', 'scheduled', { chair: { id: 'c1', label: '1' } })],
      didNotCome: [row('4', 'Sami', '1', 'did_not_come', { chair: { id: 'c1', label: '1' } })],
    });
    const grid = await screen.findByRole('list', { name: 'Machines in this block' });
    expect(within(grid).getAllByRole('link').map((a) => a.getAttribute('aria-label'))).toEqual(['Machine 1: Omar, Waiting']);
  });

  it('shows how long an active session has been running', async () => {
    const openedAt = new Date(Date.now() - 80 * 60_000 - 5_000).toISOString();
    mount(FRONT, { active: [row('1', 'Layla', '1', 'active', { openedAt })] });
    const elapsed = await screen.findByText(/on the machine/);
    expect(elapsed).toHaveTextContent(/^1 h 20 min on the machine · started \S.*$/);
  });

  it('keeps the block tabs readable when not selected', async () => {
    mount(FRONT, {});
    const afternoon = await screen.findByText('Afternoon');
    expect(afternoon.closest('label')!.style.color).toBe('var(--mantine-color-uoca-8)');
  });

  it('a nurse sees only her machines until she turns the toggle off', async () => {
    mount(NURSE, {
      waiting: [row('1', 'Mine P', '1', 'scheduled', { mine: true }), row('2', 'Other P', '2', 'scheduled')],
    });
    expect(await screen.findByRole('link', { name: 'Mine P' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Other P' })).not.toBeInTheDocument();
    expect(screen.getByText(/1 other machine/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'My machines' }));
    expect(await screen.findByRole('link', { name: 'Other P' })).toBeInTheDocument();
  });

  it('the front desk sees every machine by default', async () => {
    mount(FRONT, { waiting: [row('1', 'Mine P', '1', 'scheduled', { mine: true }), row('2', 'Other P', '2', 'scheduled')] });
    expect(await screen.findByRole('link', { name: 'Other P' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mine P' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'My machines' })).not.toBeChecked();
  });

  it('shows the My machines toggle only to users who can run sessions', async () => {
    mount(['sessions.view'], { waiting: [row('1', 'Mine P', '1', 'scheduled', { mine: true }), row('2', 'Other P', '2', 'scheduled')] });
    expect(await screen.findByRole('link', { name: 'Other P' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mine P' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'My machines' })).toBeNull();
  });

  it('shows row actions by permission', async () => {
    mount(['sessions.view'], { waiting: [row('1', 'Omar', '1', 'scheduled')] });
    await screen.findByRole('link', { name: 'Omar' });
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Did not come' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Postpone' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toBeInTheDocument();
  });

  it('Start posts open and goes straight to the session page', async () => {
    useCentreUser(NURSE);
    let posted = 0;
    server.use(
      http.get('*/api/centres/c1/board', () => HttpResponse.json({ ...empty, waiting: [row('1', 'Omar', '1', 'scheduled', { mine: true })] })),
      http.post('*/api/centres/c1/sessions/1/open', () => (posted++, HttpResponse.json({}))),
    );
    renderApp(
      <Routes>
        <Route path="/c/:centreId/today" element={<BoardPage />} />
        <Route path="/c/:centreId/sessions/:sessionId" element={<p>session page</p>} />
      </Routes>,
      '/c/c1/today',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByText('session page')).toBeInTheDocument();
    expect(posted).toBe(1);
  });

  it("the patient's name opens the session", async () => {
    mount(FRONT, { waiting: [row('1', 'Omar', '1', 'scheduled')] });
    expect(await screen.findByRole('link', { name: 'Omar' })).toHaveAttribute('href', '/c/c1/sessions/1');
  });

  it('Postpone posts and opens the make-up booking when the user may book one', async () => {
    let posted = 0;
    mount(FRONT, { waiting: [row('1', 'Omar', '1', 'scheduled')] });
    server.use(
      http.post('*/api/centres/c1/sessions/1/postpone', () => (posted++, HttpResponse.json({}))),
      http.get('*/api/centres/c1/schedule/setup', () => HttpResponse.json({ shifts: [], chairs: [], workingDays: [1] })),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Postpone' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Date')).toBeInTheDocument();
    expect(posted).toBe(1);
  });

  it('Postpone without make-up permission just posts', async () => {
    let posted = 0;
    mount(NURSE, { waiting: [row('1', 'Omar', '1', 'scheduled', { mine: true })] });
    server.use(http.post('*/api/centres/c1/sessions/1/postpone', () => (posted++, HttpResponse.json({}))));
    await userEvent.click(await screen.findByRole('button', { name: 'Postpone' }));
    await waitFor(() => expect(posted).toBe(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Did not come asks for an optional reason and posts', async () => {
    let body: unknown;
    mount(FRONT, { waiting: [row('1', 'Omar', '1', 'scheduled')] });
    server.use(
      http.post('*/api/centres/c1/sessions/1/did-not-come', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Did not come' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Sick');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record did not come' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({ reason: 'Sick' });
  });

  it('warns about sessions left open on earlier days, with a link to each', async () => {
    mount(FRONT, { unclosed: [row('9', 'Laila', '4', 'active', { date: '2026-10-17' })] });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('1 session from an earlier day is still open')).toBeInTheDocument();
    expect(within(alert).getByText(/Oct 17, 2026 · Morning · Machine 4 · Laila/)).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/c/c1/sessions/9');
  });

  it('says the centre is closed on a non-working day', async () => {
    mount(FRONT, { working: false, shiftId: null });
    expect(await screen.findByText('Centre closed today')).toBeInTheDocument();
  });
});
