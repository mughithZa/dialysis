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
const row = (id: string, date: string, status = 'scheduled') => ({ id, date, block: 'Morning', chairLabel: '1', centreId: 'c1', status, kind: 'regular' });

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
      HttpResponse.json({ upcoming: [row('f1', addDaysLocal(2))], today: [row('t1', todayLocal())], past: [row('d1', 'x', 'completed')], notes: [] }),
    ),
    http.get('*/api/centres/c1/patients/p1/sessions', () => HttpResponse.json([])),
  );

describe('PatientPage session actions', () => {
  it('offers Move and Cancel on upcoming, Did not come on today, per permission', async () => {
    useCentreUser(['patients.view', 'schedule.view', 'schedule.book', 'sessions.view', 'sessions.postpone']);
    handlers();
    mount();
    const lines = await screen.findAllByText(/Morning · 1/);
    expect(lines).toHaveLength(2);
    expect(await screen.findByText('Mon: Morning, machine 1')).toBeTruthy();
    const future = lines.find((l) => l.textContent?.includes(addDaysLocal(2)))!.parentElement!;
    expect(within(future).getByRole('button', { name: 'Move' })).toBeTruthy();
    expect(within(future).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(within(future).queryByRole('button', { name: 'Did not come' })).toBeNull();
    const now = lines.find((l) => l.textContent?.includes(todayLocal()))!.parentElement!;
    expect(within(now).getByRole('button', { name: 'Did not come' })).toBeTruthy();

    await userEvent.click(within(future).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByLabelText('Reason')).toBeTruthy();
  });

  it('hides Move without schedule.book', async () => {
    useCentreUser(['patients.view', 'schedule.view', 'sessions.view', 'sessions.postpone']);
    handlers();
    mount();
    await screen.findAllByText(/Morning · 1/);
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Cancel' }).length).toBeGreaterThan(0);
  });
});
