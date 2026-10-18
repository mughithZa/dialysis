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
  it('renders blocks, the Active and Waiting groups and the summary line', async () => {
    mount(FRONT, {
      active: [row('1', 'Layla', '1', 'active', { hasActiveOrders: true })],
      waiting: [row('2', 'Omar', '2', 'scheduled')],
      done: [row('3', 'Huda P', '3', 'completed')],
      didNotCome: [row('4', 'Sami', '4', 'did_not_come')],
      other: [row('5', 'Rana', '5', 'postponed')],
      emptyMachines: [{ id: 'm6', label: '6' }],
    });
    expect(await screen.findByText('Layla')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Morning' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Afternoon' })).toBeInTheDocument();
    expect(screen.getByText('Active now (1)')).toBeInTheDocument();
    expect(screen.getByText('Waiting (1)')).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Omar')).toBeInTheDocument();
    expect(screen.getByText(/Done 1/)).toBeInTheDocument();
    expect(screen.getByText(/Did not come 1/)).toBeInTheDocument();
    expect(screen.getByText(/Postponed or cancelled 1/)).toBeInTheDocument();
    expect(screen.getByText(/Empty machines: 6/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open' })[0]).toHaveAttribute('href', '/c/c1/sessions/1');
  });

  it('a nurse sees only her machines until she turns the toggle off', async () => {
    mount(NURSE, {
      waiting: [row('1', 'Mine P', '1', 'scheduled', { mine: true }), row('2', 'Other P', '2', 'scheduled')],
    });
    expect(await screen.findByText('Mine P')).toBeInTheDocument();
    expect(screen.queryByText('Other P')).not.toBeInTheDocument();
    expect(screen.getByText(/1 other machine/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'My machines' }));
    expect(await screen.findByText('Other P')).toBeInTheDocument();
  });

  it('the front desk sees every machine by default', async () => {
    mount(FRONT, { waiting: [row('1', 'Mine P', '1', 'scheduled', { mine: true }), row('2', 'Other P', '2', 'scheduled')] });
    expect(await screen.findByText('Other P')).toBeInTheDocument();
    expect(screen.getByText('Mine P')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'My machines' })).not.toBeChecked();
  });

  it('shows row actions by permission', async () => {
    mount(['sessions.view'], { waiting: [row('1', 'Omar', '1', 'scheduled')] });
    await screen.findByText('Omar');
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Did not come' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Postpone' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toBeInTheDocument();
  });

  it('Start posts open and the row moves to Active after the refetch', async () => {
    useCentreUser(NURSE);
    let opened = false;
    let posted = 0;
    server.use(
      http.get('*/api/centres/c1/board', () =>
        HttpResponse.json(
          opened
            ? { ...empty, active: [row('1', 'Omar', '1', 'active', { mine: true })] }
            : { ...empty, waiting: [row('1', 'Omar', '1', 'scheduled', { mine: true })] },
        ),
      ),
      http.post('*/api/centres/c1/sessions/1/open', () => {
        posted++;
        opened = true;
        return HttpResponse.json({});
      }),
    );
    renderApp(
      <Routes>
        <Route path="/c/:centreId/today" element={<BoardPage />} />
      </Routes>,
      '/c/c1/today',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Active now (1)')).toBeInTheDocument();
    expect(posted).toBe(1);
    expect(screen.queryByText('Waiting (1)')).not.toBeInTheDocument();
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

  it('says the centre is closed on a non-working day', async () => {
    mount(FRONT, { working: false, shiftId: null });
    expect(await screen.findByText('Centre closed today')).toBeInTheDocument();
  });
});
