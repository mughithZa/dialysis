import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { PatientsPage } from './PatientsPage';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

const patient = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  userId: `u${id}`,
  name,
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
  nextSession: null,
  ...over,
});

describe('PatientsPage', () => {
  it("shows each patient's next session, and a status badge only when not active", async () => {
    useCentreUser(['patients.view']);
    server.use(
      http.get('*/api/centres/c1/patients', () =>
        HttpResponse.json([
          patient('1', 'Omar', { nextSession: { date: '2026-10-21', start: '07:00' } }),
          patient('2', 'Rana'),
          patient('3', 'Sami', { status: 'transferring' }),
        ]),
      ),
    );
    renderApp(<PatientsPage />);
    expect(await screen.findByText('Next: Wednesday, Oct 21 · 07:00')).toBeVisible();
    expect(screen.getAllByText('No upcoming session')).toHaveLength(2);
    expect(within(screen.getByRole('link', { name: /Omar/ })).queryByText('Active')).not.toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: /Sami/ })).getByText('Transferring')).toBeVisible();
  });
});
