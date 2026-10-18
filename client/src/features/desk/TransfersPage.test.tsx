import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { TransfersPage } from './TransfersPage';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

const incoming = [
  {
    id: 't1',
    status: 'pending',
    sentAt: '2026-10-10T08:00:00.000Z',
    note: 'Moving house',
    fromCentre: { id: 'c2', name: 'Aleppo' },
    patient: { name: 'Layla Aziz', phone: '0933', kidneyFailureCause: null },
  },
];

describe('TransfersPage', () => {
  it('accepts an incoming transfer', async () => {
    useCentreUser(['transfers.decide']);
    const calls: string[] = [];
    server.use(
      http.get('*/api/centres/c1/transfers', () => HttpResponse.json(incoming)),
      http.post('*/api/centres/c1/transfers/t1/accept', () => {
        calls.push('accept');
        return HttpResponse.json({ id: 't1', status: 'accepted' });
      }),
    );
    renderApp(<TransfersPage />);
    expect(await screen.findByText('Layla Aziz')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(calls).toEqual(['accept']));
  });

  it('outgoing shows the patient name linking to the patient page when present', async () => {
    useCentreUser(['transfers.send']);
    server.use(
      http.get('*/api/centres/c1/transfers', () =>
        HttpResponse.json([
          { id: 'o1', status: 'pending', sentAt: '2026-10-10T08:00:00.000Z', note: null, toCentre: { id: 'c2', name: 'Aleppo' }, rejectReason: null, patient: { id: 'p1', name: 'Omar Said' } },
          { id: 'o2', status: 'accepted', sentAt: '2026-10-09T08:00:00.000Z', note: null, toCentre: { id: 'c3', name: 'Homs' }, rejectReason: null, patient: null },
        ]),
      ),
    );
    renderApp(<TransfersPage />);
    const link = await screen.findByRole('link', { name: 'Omar Said' });
    expect(link.getAttribute('href')).toBe('/c/c1/patients/p1');
    expect(screen.getByText('To Homs')).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('requires a reason to reject, then sends it', async () => {
    useCentreUser(['transfers.decide']);
    let body: unknown;
    server.use(
      http.get('*/api/centres/c1/transfers', () => HttpResponse.json(incoming)),
      http.post('*/api/centres/c1/transfers/t1/reject', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 't1', status: 'rejected' });
      }),
    );
    renderApp(<TransfersPage />);
    await screen.findByText('Layla Aziz');
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const confirm = await screen.findByRole('button', { name: 'Reject transfer' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason'), 'No capacity');
    await userEvent.click(confirm);
    await waitFor(() => expect(body).toEqual({ reason: 'No capacity' }));
  });
});
