import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { PatientPage } from './PatientPage';
import { todayLocal, addDaysLocal } from './dates';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

const patient = {
  id: 'p1',
  userId: 'u1',
  name: 'Ahmad Nour',
  phone: null,
  emergencyContact: { name: null, phone: null, relation: null },
  kidneyFailureCause: null,
  address: null,
  socialSituation: null,
  financialSituation: null,
  otherDiseases: null,
  notes: null,
  status: 'active',
  discharge: null,
};
const row = (id: string, date: string, status = 'scheduled') => ({
  id,
  date,
  start: '08:00',
  end: '12:00',
  block: 'Morning',
  chairLabel: '1',
  centreId: 'c1',
  centreName: 'Damascus',
  status,
  kind: 'regular',
  detached: false,
  oneOff: false,
  nurse: null,
  medicines: [],
  linkable: true,
});

const mount = () =>
  renderApp(
    <Routes>
      <Route path="/c/:centreId/patients/:patientId" element={<PatientPage />} />
    </Routes>,
    '/c/c1/patients/p1',
  );

const handlers = () =>
  server.use(
    http.get('*/api/centres/c1/patients/p1', () => HttpResponse.json(patient)),
    http.get('*/api/centres/c1/patients/p1/plan', () =>
      HttpResponse.json({ plan: { id: 'pl', patientId: 'p1', items: [{ weekday: 1, shiftId: 's1', chairId: 'm1' }], from: '2026-10-01', to: null, repeat: 'weekly' } }),
    ),
    http.get('*/api/centres/c1/schedule/setup', () =>
      HttpResponse.json({ machines: [{ id: 'm1', label: '1', active: true }], blocks: [{ id: 's1', name: 'Morning', start: '08:00', end: '12:00' }], workingDays: [1] }),
    ),
    http.get('*/api/centres/c1/patients/p1/timeline', () =>
      HttpResponse.json({ upcoming: [row('f1', addDaysLocal(2))], today: [row('t1', todayLocal())], past: [row('d1', '2026-01-05', 'completed')], notes: [] }),
    ),
  );

const openRowMenu = async (id: string) => {
  const row = within(await screen.findByTestId(`timeline-row-${id}`));
  await userEvent.click(row.getByRole('button', { name: /^Actions for / }));
  return within(await screen.findByRole('menu'));
};

describe('PatientPage session actions', () => {
  it('puts Move / Postpone / Cancel in an upcoming row menu and Did not come on today, per permission', async () => {
    useCentreUser(['patients.view', 'schedule.view', 'schedule.book', 'sessions.view', 'sessions.postpone']);
    handlers();
    mount();
    const future = await openRowMenu('f1');
    expect(future.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Move', 'Postpone', 'Cancel']);
    await userEvent.click(future.getByRole('menuitem', { name: 'Cancel' }));
    expect(await screen.findByLabelText('Reason')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const now = await openRowMenu('t1');
    expect(now.getByRole('menuitem', { name: 'Did not come' })).toBeTruthy();
    // past completed sessions have no menu
    expect(within(screen.getByTestId('timeline-row-d1')).queryAllByRole('button')).toHaveLength(0);
  });

  it('postpones a session from its row, then offers the make-up', async () => {
    useCentreUser(['patients.view', 'schedule.view', 'schedule.makeup', 'sessions.view', 'sessions.postpone']);
    handlers();
    const posted: string[] = [];
    server.use(
      http.post('*/api/centres/c1/sessions/:sid/postpone', ({ params }) => {
        posted.push(String(params.sid));
        return HttpResponse.json({});
      }),
    );
    mount();
    const menu = await openRowMenu('f1');
    await userEvent.click(menu.getByRole('menuitem', { name: 'Postpone' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Postpone' }));
    await waitFor(() => expect(posted).toEqual(['f1']));
    expect(await screen.findByRole('dialog', { name: 'Make-up session' })).toBeTruthy();
  });

  it('hides Move without schedule.book', async () => {
    useCentreUser(['patients.view', 'schedule.view', 'sessions.view', 'sessions.postpone']);
    handlers();
    mount();
    const menu = await openRowMenu('f1');
    expect(menu.queryByRole('menuitem', { name: 'Move' })).toBeNull();
    expect(menu.getByRole('menuitem', { name: 'Cancel' })).toBeTruthy();
  });

  it('shows no row menu without session permissions', async () => {
    useCentreUser(['patients.view', 'schedule.view', 'sessions.view']);
    handlers();
    mount();
    await screen.findByTestId('timeline-row-f1');
    expect(screen.queryByRole('button', { name: /^Actions for / })).toBeNull();
  });
});

describe('PatientPage actions', () => {
  it('has one primary action and puts the rest, by permission, in More actions', async () => {
    useCentreUser(['patients.view', 'patients.edit', 'schedule.view', 'schedule.book', 'schedule.makeup', 'patients.discharge', 'transfers.send', 'users.resetPassword']);
    handlers();
    mount();
    // the patient has a weekly plan, so Make-up is the primary action
    expect(await screen.findByRole('button', { name: 'Make-up session' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Change weekly plan',
      'Edit',
      'Transfer to another centre',
      'Reset patient password',
      'Discharge',
    ]);
    await userEvent.click(menu.getByRole('menuitem', { name: 'Discharge' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('offers Book schedule first when the patient has no plan', async () => {
    useCentreUser(['patients.view', 'patients.edit', 'schedule.view', 'schedule.book']);
    handlers();
    server.use(http.get('*/api/centres/c1/patients/p1/plan', () => HttpResponse.json({ plan: null })));
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Book schedule' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent)).toEqual(['Edit']);
  });

  it('shows only Edit (no menu) with just patients.edit, and no actions at all for a viewer', async () => {
    useCentreUser(['patients.view', 'patients.edit']);
    handlers();
    const { unmount } = mount();
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    unmount();

    useCentreUser(['patients.view', 'sessions.view']);
    handlers();
    mount();
    await screen.findByRole('heading', { name: 'Ahmad Nour' });
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('discharged patients only keep edit and password reset', async () => {
    useCentreUser(['patients.view', 'patients.edit', 'schedule.view', 'schedule.book', 'schedule.makeup', 'patients.discharge', 'transfers.send', 'users.resetPassword']);
    handlers();
    server.use(http.get('*/api/centres/c1/patients/p1', () => HttpResponse.json({ ...patient, status: 'discharged', discharge: { reason: 'moved', date: '2026-10-01' } })));
    mount();
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent)).toEqual(['Reset patient password']);
  });
});

describe('PatientPage tabs', () => {
  it('shows the weekly plan on Schedule and the record as a definition list', async () => {
    useCentreUser(['patients.view', 'schedule.view', 'sessions.view']);
    handlers();
    mount();
    expect(await screen.findByRole('tab', { name: 'Sessions', selected: true })).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
    expect(await screen.findByText('Mon: Morning, machine 1')).toBeTruthy();
    expect(document.querySelectorAll('[data-plan-slot]')).toHaveLength(1);
    await userEvent.click(screen.getByRole('tab', { name: 'Record' }));
    expect(await screen.findByText('Cause of kidney failure')).toBeTruthy();
    expect(screen.getAllByLabelText('Not recorded').length).toBeGreaterThan(0);
  });

  it('opens on Orders for a doctor, and has no Schedule tab without schedule.view', async () => {
    useCentreUser(['patients.view', 'sessions.view', 'orders.view', 'orders.write']);
    handlers();
    server.use(
      http.get('*/api/centres/c1/patients/p1/orders', () => HttpResponse.json([])),
      http.get('*/api/centres/c1/patients/p1/notes', () => HttpResponse.json([])),
    );
    mount();
    expect(await screen.findByRole('tab', { name: 'Orders', selected: true })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Schedule' })).toBeNull();
  });
});
