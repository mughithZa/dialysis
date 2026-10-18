import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { DashboardPage } from './DashboardPage';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

describe('DashboardPage', () => {
  it('renders a card per centre with sessions, patients and item totals', async () => {
    let month = '';
    server.use(
      http.get('*/api/auth/me', () =>
        HttpResponse.json({ id: 'u', name: 'PM', kind: 'staff', globalPermissions: ['stats.global'], centres: [] }),
      ),
      http.get('*/api/stats', ({ request }) => {
        month = new URL(request.url).searchParams.get('month') ?? '';
        return HttpResponse.json([
          {
            centre: { id: 'c1', name: 'Damascus' },
            sessions: 42,
            patients: 7,
            medicines: [{ item: { id: 'm1', name: 'Heparin' }, unit: 'mg', total: 1500 }],
            supplies: [{ item: { id: 's1', name: 'Gloves' }, unit: 'pair', total: 88 }],
          },
        ]);
      }),
    );
    renderApp(<DashboardPage />);
    const card = (await screen.findByText('Damascus')).closest('[data-centre-stats]') as HTMLElement;
    expect(within(card).getByText('42')).toBeTruthy();
    expect(within(card).getByText('7')).toBeTruthy();
    expect(within(card).getByText('Heparin')).toBeTruthy();
    expect(within(card).getByText('1500')).toBeTruthy();
    expect(within(card).getByText('pair')).toBeTruthy();
    expect(month).toMatch(/^\d{4}-\d{2}$/);
  });
});
