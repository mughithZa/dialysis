import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { SessionHistory } from './SessionHistory';
import { renderApp } from '../test/render';
import { server } from '../test/server';
import { useCentreUser } from '../test/auth';

describe('SessionHistory', () => {
  it('links each session to its session page', async () => {
    useCentreUser(['sessions.view']);
    server.use(
      http.get('*/api/centres/c1/patients/p1/sessions', () =>
        HttpResponse.json([
          {
            id: 's9',
            date: '2026-10-10',
            status: 'completed',
            kind: 'regular',
            chair: { id: 'c', label: 'Chair 1' },
            shift: { id: 'sh', name: 'Morning' },
            centreId: 'c1',
            centreName: 'Damascus',
            vitals: { weightBefore: null, weightAfter: null, bp: [] },
            notes: [],
            usage: [],
          },
        ]),
      ),
    );
    renderApp(<SessionHistory patientId="p1" />);
    expect(await screen.findByRole('link', { name: '2026-10-10' })).toHaveAttribute('href', '/c/c1/sessions/s9');
  });

  it('renders a session held at another centre without a link', async () => {
    useCentreUser(['sessions.view']);
    server.use(
      http.get('*/api/centres/c1/patients/p1/sessions', () =>
        HttpResponse.json([
          {
            id: 's8',
            date: '2026-09-01',
            status: 'completed',
            kind: 'regular',
            chair: { id: 'c', label: 'Chair 2' },
            shift: { id: 'sh', name: 'Morning' },
            centreId: 'c2',
            centreName: 'Aleppo',
            vitals: { weightBefore: null, weightAfter: null, bp: [] },
            notes: [],
            usage: [],
          },
        ]),
      ),
    );
    renderApp(<SessionHistory patientId="p1" />);
    expect(await screen.findByText('2026-09-01')).toBeInTheDocument();
    expect(screen.getByText(/Aleppo/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '2026-09-01' })).toBeNull();
  });
});
