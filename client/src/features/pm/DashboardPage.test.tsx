import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { DashboardPage } from './DashboardPage';
import { currentMonth, shiftMonth } from '../../components/stats/month';
import type { CentreStats } from '../../components/StatsCard';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

const centre = (id: string, name: string, sessions: number, patients: number, over: Partial<CentreStats> = {}): CentreStats => ({
  centre: { id, name },
  sessions,
  patients,
  medicines: [],
  supplies: [],
  ...over,
});

const THIS = currentMonth();
const PREV = shiftMonth(THIS, -1);

/** This month: Damascus 42 sessions, Aleppo 10. Last month: Damascus 30, Aleppo 15. */
function useStatsApi(seen: string[] = []) {
  server.use(
    http.get('*/api/auth/me', () =>
      HttpResponse.json({ id: 'u', name: 'PM', kind: 'staff', globalPermissions: ['stats.global'], centres: [] }),
    ),
    http.get('*/api/stats', ({ request }) => {
      const month = new URL(request.url).searchParams.get('month') ?? '';
      seen.push(month);
      if (month === THIS)
        return HttpResponse.json([
          centre('c1', 'Damascus', 42, 7, {
            medicines: [
              { item: { id: 'm1', name: 'Heparin' }, unit: 'mg', total: 1500 },
              { item: { id: 'm2', name: 'EPO' }, unit: 'IU', total: 4000 },
            ],
            supplies: [{ item: { id: 's1', name: 'Gloves' }, unit: 'pair', total: 88 }],
          }),
          centre('c2', 'Aleppo', 10, 3, { medicines: [{ item: { id: 'm1', name: 'Heparin' }, unit: 'mg', total: 300 }] }),
        ]);
      if (month === PREV)
        return HttpResponse.json([
          centre('c1', 'Damascus', 30, 7, { medicines: [{ item: { id: 'm1', name: 'Heparin' }, unit: 'mg', total: 900 }] }),
          centre('c2', 'Aleppo', 15, 4),
        ]);
      return HttpResponse.json([centre('c1', 'Damascus', 0, 0), centre('c2', 'Aleppo', 0, 0)]);
    }),
  );
  return seen;
}

const card = async (name: string) =>
  (await screen.findByRole('heading', { name })).closest('[data-centre-stats]') as HTMLElement;

describe('DashboardPage', () => {
  it('renders network totals and a card per centre with sessions, patients and usage bars', async () => {
    useStatsApi();
    renderApp(<DashboardPage />);
    const totals = (await screen.findByText('Sessions this month')).closest('[data-network-totals]') as HTMLElement;
    const value = (label: string) => within(totals).getByText(label).previousElementSibling?.textContent;
    expect(value('Centres')).toBe('2');
    expect(value('Sessions this month')).toBe('52');
    expect(value('Patients')).toBe('10');
    expect(value('Medicines used')).toBe('2'); // Heparin and EPO, counted once across centres

    const damascus = await card('Damascus');
    expect(within(damascus).getByText('42')).toBeTruthy();
    expect(within(damascus).getByText('7')).toBeTruthy();
    const heparin = damascus.querySelector('[data-usage-bar="Heparin"]') as HTMLElement;
    expect(heparin.textContent).toContain('1500 mg');
    expect(damascus.querySelector('[data-usage-bar="Gloves"]')?.textContent).toContain('88 pair');
  });

  it('fetches this month and last month and shows the change per centre and for the network', async () => {
    const seen = useStatsApi();
    renderApp(<DashboardPage />);
    await screen.findByText('Sessions per centre');
    expect(seen).toContain(THIS);
    expect(seen).toContain(PREV);

    // network: 52 against 45
    const totals = screen.getByText('Sessions this month').closest('[data-stat-card]') as HTMLElement;
    expect(totals.querySelector('[data-delta]')?.getAttribute('data-delta')).toBe('up');
    expect(totals.querySelector('[data-delta-value]')?.textContent).toBe('+7 (+16%)');

    // the comparison table: both months and the change for each centre
    const row = (name: string) => document.querySelector(`[data-comparison-row="${name}"]`) as HTMLElement;
    expect(within(row('Damascus')).getAllByRole('cell').map((c) => c.textContent?.trim())[1]).toBe('42');
    expect(within(row('Damascus')).getAllByRole('cell')[2]!.textContent).toBe('30');
    expect(row('Damascus').querySelector('[data-delta-value]')?.textContent).toBe('+12 (+40%)');
    expect(row('Aleppo').querySelector('[data-delta]')?.getAttribute('data-delta')).toBe('down');
    expect(row('Aleppo').querySelector('[data-delta-value]')?.textContent).toBe('−5 (−33%)');

    // the centre cards carry the same change on their sessions and patients
    const aleppo = await card('Aleppo');
    const deltas = [...aleppo.querySelectorAll('[data-delta-value]')].map((d) => d.textContent);
    expect(deltas).toEqual(['−5 (−33%)', '−1 (−25%)']);
    expect(within(aleppo).getByText('5 fewer than ' + new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(`${PREV}-15T12:00`)))).toBeTruthy();
  });

  it('steps back a month with the month control and cannot go past this month', async () => {
    const seen = useStatsApi();
    renderApp(<DashboardPage />);
    await screen.findByText('Sessions per centre');
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(seen).toContain(shiftMonth(THIS, -2)));
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows usage as a table on request', async () => {
    useStatsApi();
    renderApp(<DashboardPage />);
    const damascus = await card('Damascus');
    expect(within(damascus).queryByRole('table')).toBeNull();
    await userEvent.click(within(damascus).getByRole('button', { name: 'Show Medicines as a table' }));
    expect(within(damascus).getByRole('row', { name: /Heparin\s+1500\s+mg/ })).toBeTruthy();
    expect(within(damascus).getByRole('button', { name: 'Show Medicines as bars' }).getAttribute('aria-expanded')).toBe('true');
  });
});
