import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { SessionPage } from './SessionPage';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';
import { todayLocal } from '../desk/dates';

const RUN = ['sessions.view', 'sessions.run', 'sessions.recordUsage', 'sessions.recordVitals', 'sessions.addNotes'];

const heparinLine = { id: 'l1', item: { id: 'i1', name: 'Heparin', type: 'medicine', unit: 'IU' }, amount: 5000, by: { id: 'u', name: 'Sara' }, at: '2026-10-18T08:00:00Z' };
const salineLine = { id: 'l2', item: { id: 'i2', name: 'Saline', type: 'supply', unit: 'ml' }, amount: 250, by: { id: 'u', name: 'Sara' }, at: '2026-10-18T08:10:00Z' };

const detail = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  date: todayLocal(),
  status: 'active',
  kind: 'regular',
  chair: { id: 'ch1', label: 'Chair 1' },
  shift: { id: 'sh1', name: 'Morning', start: '07:00', end: '11:00' },
  chairLabel: 'Chair 1',
  start: '07:00',
  end: '11:00',
  patient: { id: 'p1', name: 'Layla' },
  hasActiveOrders: false,
  vitals: { weightBefore: null, weightAfter: null, bp: [] },
  notes: [],
  usage: [],
  orders: [],
  recentNotes: [],
  openedAt: null,
  closedAt: null,
  ...over,
});

const items = [
  { id: 'i1', name: 'Heparin', type: 'medicine', unitId: 'u1', status: 'approved', mergedInto: null, used: true },
  { id: 'i2', name: 'Saline', type: 'supply', unitId: 'u2', status: 'approved', mergedInto: null, used: true },
];
const units = [
  { id: 'u1', name: 'IU' },
  { id: 'u2', name: 'ml' },
];

function mount(session: Record<string, unknown>, perms = RUN) {
  useCentreUser(perms);
  server.use(
    http.get('*/api/centres/c1/sessions/s1', () => HttpResponse.json(session)),
    http.get('*/api/catalog/items', () => HttpResponse.json(items)),
    http.get('*/api/catalog/units', () => HttpResponse.json(units)),
  );
  return renderApp(
    <Routes>
      <Route path="/c/:centreId/sessions/:sessionId" element={<SessionPage />} />
    </Routes>,
    '/c/c1/sessions/s1',
  );
}

const tab = (name: RegExp) => userEvent.click(screen.getByRole('tab', { name }));

describe('SessionPage', () => {
  it('shows the machine label and block times the session was booked with, not the live setup', async () => {
    mount(detail({ status: 'completed', date: '2026-09-01', chairLabel: '3', start: '06:00', end: '10:00' }));
    expect(await screen.findByText('Machine 3 · Morning (06:00–10:00) · Tuesday, Sep 1')).toBeVisible();
  });

  it('asks before closing without heparin and "Close anyway" posts /close', async () => {
    let closed = 0;
    server.use(http.post('*/api/centres/c1/sessions/s1/close', () => (closed++, HttpResponse.json(detail({ status: 'completed' })))));
    mount(detail({ usage: [salineLine] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close session' }));
    expect(await screen.findByText('No heparin recorded. Close anyway?')).toBeInTheDocument();
    expect(closed).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Close anyway' }));
    await waitFor(() => expect(closed).toBe(1));
  });

  it('"Go back" dismisses the warning without closing', async () => {
    let closed = 0;
    server.use(http.post('*/api/centres/c1/sessions/s1/close', () => (closed++, HttpResponse.json({}))));
    mount(detail());
    await userEvent.click(await screen.findByRole('button', { name: 'Close session' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(screen.queryByText('No heparin recorded. Close anyway?')).toBeNull());
    expect(closed).toBe(0);
  });

  it('closes directly when a heparin line exists (case-insensitive)', async () => {
    let closed = 0;
    server.use(http.post('*/api/centres/c1/sessions/s1/close', () => (closed++, HttpResponse.json(detail({ status: 'completed' })))));
    mount(detail({ usage: [{ ...heparinLine, item: { ...heparinLine.item, name: ' HEPARIN ' } }] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close session' }));
    await waitFor(() => expect(closed).toBe(1));
    expect(screen.queryByText('No heparin recorded. Close anyway?')).toBeNull();
  });

  it('shows the doctor order text in a banner only when orders exist', async () => {
    mount(detail({ hasActiveOrders: true, orders: [{ id: 'o1', text: 'Reduce UF to 2 L', from: todayLocal(), doctor: { id: 'd', name: 'Dr Omar' } }] }));
    expect(await screen.findByText('Reduce UF to 2 L')).toBeInTheDocument();
    expect(screen.getByText(/Dr Omar/)).toBeInTheDocument();
  });

  it('shows recent doctor notes in the orders banner, with or without orders', async () => {
    mount(detail({ recentNotes: [{ id: 'n1', at: new Date().toISOString(), text: 'Watch the access site', author: { name: 'Dr Omar' } }] }));
    expect(await screen.findByText('Watch the access site')).toBeInTheDocument();
    expect(screen.getByText('Doctor notes')).toBeInTheDocument();
    expect(screen.getByText(/Dr Omar/)).toBeInTheDocument();
  });

  it('has no orders banner without orders', async () => {
    mount(detail());
    await screen.findByRole('button', { name: 'Close session' });
    expect(screen.queryByText('Doctor orders')).toBeNull();
  });

  it('hides edit actions on a completed session without sessions.editClosed', async () => {
    mount(detail({ status: 'completed', usage: [heparinLine], notes: [{ id: 'n1', at: '2026-10-18T09:00:00Z', by: { id: 'u', name: 'Sara' }, text: 'Stable' }] }));
    expect(await screen.findByText('Heparin')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add medicine/supply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More for Heparin' })).toBeNull();
    await tab(/Vitals/);
    expect(screen.queryByRole('button', { name: 'Add reading' })).toBeNull();
    await tab(/Notes/);
    expect(screen.getByText('Stable')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save note' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close session' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change history' })).toBeNull();
  });

  it('shows edit actions and the history button on a completed session with sessions.editClosed and viewHistory', async () => {
    mount(detail({ status: 'completed', usage: [heparinLine] }), [...RUN, 'sessions.editClosed', 'sessions.viewHistory']);
    expect(await screen.findByRole('button', { name: 'Add medicine/supply' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change history' })).toBeInTheDocument();
  });

  it('opens a scheduled session today and offers postpone', async () => {
    let opened = 0;
    server.use(http.post('*/api/centres/c1/sessions/s1/open', () => (opened++, HttpResponse.json({}))));
    mount(detail({ status: 'scheduled' }), [...RUN, 'sessions.postpone']);
    expect(await screen.findByRole('button', { name: 'Postpone' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open session' }));
    await waitFor(() => expect(opened).toBe(1));
  });

  it('does not offer Open for a scheduled session on another day', async () => {
    mount(detail({ status: 'scheduled', date: '2020-01-01' }));
    await screen.findByText('Layla');
    expect(screen.queryByRole('button', { name: 'Open session' })).toBeNull();
  });

  it('adds usage through the picker, posting {itemId, amount}', async () => {
    const bodies: unknown[] = [];
    server.use(http.post('*/api/centres/c1/sessions/s1/usage', async ({ request }) => (bodies.push(await request.json()), HttpResponse.json({}, { status: 201 }))));
    mount(detail());
    await userEvent.click(await screen.findByRole('button', { name: 'Add medicine/supply' }));
    await userEvent.type(await screen.findByLabelText('Search by name'), 'sal');
    await userEvent.click(await screen.findByRole('button', { name: 'Saline' }));
    const amount = screen.getByLabelText('Amount');
    expect(amount).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByText('ml')).toBeInTheDocument();
    await userEvent.type(amount, '250');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toEqual([{ itemId: 'i2', amount: 250 }]));
  });

  it('rejects a zero amount', async () => {
    mount(detail());
    await userEvent.click(await screen.findByRole('button', { name: 'Add medicine/supply' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Saline' }));
    await userEvent.type(screen.getByLabelText('Amount'), '0');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('quick chips put Heparin first and prefill the amount form with that item', async () => {
    mount(detail({ usage: [salineLine] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add medicine/supply' }));
    const group = await screen.findByRole('group', { name: 'Recent items' });
    const chips = within(group).getAllByText(/Heparin|Saline/);
    expect(chips.map((c) => c.textContent)).toEqual(['Heparin', 'Saline']);
    await userEvent.click(chips[0]!);
    expect(await screen.findByLabelText('Amount')).toBeInTheDocument();
    expect(screen.getByText('IU')).toBeInTheDocument();
  });

  it('"Add missing item" posts the item and it then becomes selectable', async () => {
    const created: unknown[] = [];
    const list = [...items];
    mount(detail());
    server.use(
      http.get('*/api/catalog/items', () => HttpResponse.json(list)),
      http.post('*/api/catalog/items', async ({ request }) => {
        const b = (await request.json()) as { name: string; type: string; unitId: string };
        created.push(b);
        const item = { id: 'i3', ...b, status: 'pending', mergedInto: null, used: false };
        list.push(item as (typeof items)[number]);
        return HttpResponse.json(item, { status: 201 });
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Add medicine/supply' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add missing item' }));
    await userEvent.type(await screen.findByLabelText('Item name'), 'Epoetin');
    await userEvent.click(screen.getByRole('textbox', { name: 'Unit' }));
    await userEvent.click(await screen.findByRole('option', { name: 'IU' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(created).toEqual([{ name: 'Epoetin', type: 'medicine', unitId: 'u1' }]));
    expect(await screen.findByRole('button', { name: /Epoetin/ })).toBeInTheDocument();
  });

  it('records blood pressure and a note', async () => {
    const bp: unknown[] = [];
    const notes: unknown[] = [];
    server.use(
      http.post('*/api/centres/c1/sessions/s1/vitals/bp', async ({ request }) => (bp.push(await request.json()), HttpResponse.json({}, { status: 201 }))),
      http.post('*/api/centres/c1/sessions/s1/notes', async ({ request }) => (notes.push(await request.json()), HttpResponse.json({}, { status: 201 }))),
    );
    mount(detail());
    await screen.findByRole('button', { name: 'Close session' });
    await tab(/Vitals/);
    await userEvent.type(screen.getByLabelText('Systolic'), '120');
    await userEvent.type(screen.getByLabelText('Diastolic'), '80');
    await userEvent.click(screen.getByRole('button', { name: 'Add reading' }));
    await tab(/Notes/);
    await userEvent.type(screen.getByLabelText('Add a note'), 'Cramps');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(bp).toEqual([{ systolic: 120, diastolic: 80 }]));
    await waitFor(() => expect(notes).toEqual([{ text: 'Cramps' }]));
  });

  const note = { id: 'n1', at: '2026-10-18T09:00:00Z', by: { id: 'u', name: 'Sara' }, text: 'Stable' };

  it('a centre manager (view + editClosed + viewHistory, no run) sees edit controls and history on a completed session', async () => {
    mount(detail({ status: 'completed', usage: [heparinLine], notes: [note] }), ['sessions.view', 'sessions.editClosed', 'sessions.viewHistory']);
    expect(await screen.findByRole('button', { name: 'Add medicine/supply' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More for Heparin' })).toBeInTheDocument();
    await tab(/Vitals/);
    expect(screen.getByRole('button', { name: 'Add reading' })).toBeInTheDocument();
    await tab(/Notes/);
    expect(screen.getByRole('button', { name: 'Save note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More for this note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change history' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close session' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to patient' })).toHaveAttribute('href', '/c/c1/patients/p1');
  });

  it('a doctor (view + viewHistory) sees history but no edit controls', async () => {
    mount(detail({ status: 'completed', usage: [heparinLine], notes: [note] }), ['sessions.view', 'sessions.viewHistory']);
    expect(await screen.findByRole('button', { name: 'Change history' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add medicine/supply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More for Heparin' })).toBeNull();
    await tab(/Notes/);
    expect(screen.queryByRole('button', { name: 'Save note' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More for this note' })).toBeNull();
  });

  it('changes and removes a note', async () => {
    const patched: unknown[] = [];
    let deleted = 0;
    server.use(
      http.patch('*/api/centres/c1/sessions/s1/notes/n1', async ({ request }) => (patched.push(await request.json()), HttpResponse.json({}))),
      http.delete('*/api/centres/c1/sessions/s1/notes/n1', () => (deleted++, new HttpResponse(null, { status: 204 }))),
    );
    mount(detail({ notes: [note] }));
    await screen.findByText('Stable');
    await tab(/Notes/);
    await userEvent.click(screen.getByRole('button', { name: 'More for this note' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Change' }));
    const box = await screen.findByDisplayValue('Stable');
    await userEvent.clear(box);
    await userEvent.type(box, 'Cramping');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patched).toEqual([{ text: 'Cramping' }]));
    await userEvent.click(screen.getByRole('button', { name: 'More for this note' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    await waitFor(() => expect(deleted).toBe(1));
  });

  it('hides note Change/Remove on a completed session without editClosed', async () => {
    mount(detail({ status: 'completed', notes: [note] }));
    await screen.findByText('Stable');
    await tab(/Notes/);
    expect(screen.queryByRole('button', { name: 'More for this note' })).toBeNull();
  });

  it('shows the running time of an active session in the summary', async () => {
    mount(detail({ openedAt: new Date(Date.now() - 80 * 60_000 - 5_000).toISOString() }));
    const timer = await screen.findByText('1 h 20 min');
    expect(timer.closest('[data-session-timer]')).toHaveTextContent('Running1 h 20 min');
  });

  it('shows how long a completed session lasted', async () => {
    mount(detail({ status: 'completed', openedAt: '2026-10-18T07:05:00Z', closedAt: '2026-10-18T11:00:00Z' }));
    const timer = await screen.findByText('3 h 55 min');
    expect(timer.closest('[data-session-timer]')).toHaveTextContent('Duration3 h 55 min');
  });

  it('keeps Close session in a sticky action bar', async () => {
    mount(detail());
    const close = await screen.findByRole('button', { name: 'Close session' });
    expect(close.parentElement!.className).toMatch(/actionBar/);
  });

  it('shows the weight loss (UF) from the weights, live while typing', async () => {
    mount(detail({ vitals: { weightBefore: 74.1, weightAfter: null, bp: [{ at: '2026-10-18T08:00:00Z', systolic: 130, diastolic: 85 }] } }));
    await screen.findByRole('button', { name: 'Close session' });
    await tab(/Vitals/);
    const loss = document.querySelector('[data-weight-loss]')!;
    expect(loss).toHaveTextContent('-');
    await userEvent.type(screen.getByLabelText('Weight after'), '71.8');
    expect(loss).toHaveTextContent('2.3 kg');
    expect(screen.getByText('130/85')).toBeInTheDocument();
  });

  it('shows saved weights and the weight loss read-only on a closed session', async () => {
    mount(detail({ status: 'completed', vitals: { weightBefore: 80, weightAfter: 77.5, bp: [] } }));
    await screen.findByText('Layla');
    await tab(/Vitals/);
    expect(screen.getByText('80 kg')).toBeVisible();
    expect(screen.getByText('77.5 kg')).toBeVisible();
    expect(document.querySelector('[data-weight-loss]')).toHaveTextContent('2.5 kg');
    expect(screen.queryByLabelText('Weight before')).toBeNull();
  });

  it('lists medicines as rows with the amount, and changes or removes one from its menu', async () => {
    const patched: unknown[] = [];
    let deleted = 0;
    server.use(
      http.patch('*/api/centres/c1/sessions/s1/usage/l2', async ({ request }) => (patched.push(await request.json()), HttpResponse.json({}))),
      http.delete('*/api/centres/c1/sessions/s1/usage/l2', () => (deleted++, new HttpResponse(null, { status: 204 }))),
    );
    mount(detail({ usage: [heparinLine, salineLine] }));
    const row = (await screen.findByText('Saline')).closest('[data-usage-line]') as HTMLElement;
    expect(within(row).getByText('250 ml')).toBeInTheDocument();
    // no big per-row buttons: only the menu
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.getByRole('tab', { name: /Medicines/ })).toHaveTextContent('Medicines2');

    await userEvent.click(within(row).getByRole('button', { name: 'More for Saline' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Change' }));
    const amount = await screen.findByLabelText('Amount');
    expect(amount).toHaveValue('250');
    await userEvent.clear(amount);
    await userEvent.type(amount, '300');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patched).toEqual([{ amount: 300 }]));

    await userEvent.click(within(row).getByRole('button', { name: 'More for Saline' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    await waitFor(() => expect(deleted).toBe(1));
  });

  it('quick-add buttons on the page go straight to the amount for that item', async () => {
    const bodies: unknown[] = [];
    server.use(http.post('*/api/centres/c1/sessions/s1/usage', async ({ request }) => (bodies.push(await request.json()), HttpResponse.json({}, { status: 201 }))));
    mount(detail({ usage: [salineLine] }));
    const quick = await screen.findByRole('group', { name: 'Quick add' });
    await waitFor(() => expect(within(quick).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Add Heparin', 'Add Saline']));
    await userEvent.click(within(quick).getByRole('button', { name: 'Add Heparin' }));
    expect(await screen.findByText('IU')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Amount'), '5000');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toEqual([{ itemId: 'i1', amount: 5000 }]));
  });
});
