import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
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

describe('PatientPage session actions', () => {
  it('offers Move and Cancel on upcoming, Did not come on today, per permission', async () => {
    useCentreUser(['patients.view', 'schedule.view', 'schedule.book', 'sessions.view', 'sessions.postpone']);
    handlers();
    mount();
    const future = within(await screen.findByTestId('timeline-row-f1'));
    expect(await screen.findByText('Mon: Morning, machine 1')).toBeTruthy();
    expect(future.getByRole('button', { name: 'Move' })).toBeTruthy();
    expect(future.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(future.queryByRole('button', { name: 'Did not come' })).toBeNull();
    const now = within(screen.getByTestId('timeline-row-t1'));
    expect(now.getByRole('button', { name: 'Did not come' })).toBeTruthy();
    // past completed sessions have no actions
    expect(within(screen.getByTestId('timeline-row-d1')).queryAllByRole('button')).toHaveLength(0);

    await userEvent.click(future.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByLabelText('Reason')).toBeTruthy();
  });

  it('hides Move without schedule.book', async () => {
    useCentreUser(['patients.view', 'schedule.view', 'sessions.view', 'sessions.postpone']);
    handlers();
    mount();
    await screen.findByTestId('timeline-row-f1');
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Cancel' }).length).toBeGreaterThan(0);
  });
});
