import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  it("shows each patient's next session and a coloured status badge", async () => {
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
    expect(within(screen.getByRole('link', { name: /Omar/ })).getByText('Active').closest('[data-patient-status]')).toHaveAttribute('data-patient-status', 'active');
    expect(within(screen.getByRole('link', { name: /Sami/ })).getByText('Transferring').closest('[data-patient-status]')).toHaveAttribute('data-patient-status', 'transferring');
    expect(screen.getByText('3 patients')).toBeVisible();
  });

  it('filters by status with chips', async () => {
    useCentreUser(['patients.view']);
    const statuses: (string | null)[] = [];
    server.use(
      http.get('*/api/centres/c1/patients', ({ request }) => {
        statuses.push(new URL(request.url).searchParams.get('status'));
        return HttpResponse.json([patient('1', 'Omar')]);
      }),
    );
    renderApp(<PatientsPage />);
    await screen.findByRole('link', { name: /Omar/ });
    expect(screen.getByRole('radio', { name: 'Active and transferring' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Discharged' }));
    await waitFor(() => expect(statuses).toContain('discharged'));
    expect(statuses[0]).toBeNull();
  });
});
