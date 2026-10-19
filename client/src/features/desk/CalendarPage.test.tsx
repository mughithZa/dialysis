import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { CalendarPage } from './CalendarPage';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

const setup = {
  machines: [
    { id: 'm1', label: '1', active: true },
    { id: 'm2', label: '2', active: true },
  ],
  blocks: [
    { id: 's1', name: 'Morning', start: '08:00', end: '12:00' },
    { id: 's2', name: 'Afternoon', start: '12:00', end: '16:00' },
  ],
  workingDays: [0, 1, 2, 3, 4, 6],
};

const card = {
  id: 'x1',
  date: '2026-10-19',
  status: 'scheduled',
  kind: 'regular',
  chair: { id: 'm1', label: '1' },
  shift: { id: 's1', name: 'Morning', start: '08:00', end: '12:00' },
  patient: { id: 'p1', name: 'Ahmad Nour' },
};

const calendar = {
  days: [
    {
      date: '2026-10-19',
      working: true,
      blocks: [
        {
          shiftId: 's1',
          nurseByChair: { m1: { id: 'n1', name: 'Rana' }, m2: { id: 'n1', name: 'Rana' } },
          cells: [
            { chairId: 'm1', session: card, heldBy: null },
            { chairId: 'm2', session: null, heldBy: null },
          ],
        },
        {
          shiftId: 's2',
          nurseByChair: { m1: null, m2: null },
          cells: [
            { chairId: 'm1', session: null, heldBy: { patientId: 'p3', name: 'Lina Said' } },
            { chairId: 'm2', session: null, heldBy: null },
          ],
        },
      ],
    },
  ],
};

describe('CalendarPage', () => {
  it('shows nurses, No nurse for an unrostered block, booked cells, and opens BookDialog on an empty cell', async () => {
    useCentreUser(['schedule.view', 'schedule.book', 'patients.view']);
    server.use(
      http.get('*/api/centres/c1/schedule/setup', () => HttpResponse.json(setup)),
      http.get('*/api/centres/c1/schedule/calendar', () => HttpResponse.json(calendar)),
      http.get('*/api/centres/c1/patients', () => HttpResponse.json([])),
      http.get('*/api/centres/c1/schedule/free', () => HttpResponse.json([{ id: 'm2', label: '2' }])),
    );
    renderApp(<CalendarPage />);

    expect(await screen.findByText('Ahmad Nour')).toBeTruthy();
    expect(screen.getByText('Rana')).toBeTruthy();
    // exactly the unrostered block shows the warning
    expect(screen.getAllByText('No nurse')).toHaveLength(1);
    expect(screen.getByText('Lina Said')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Empty: machine 2, Morning, Oct 19, 2026' }));
    const dialog = await screen.findByRole('dialog');
    const row = within(dialog).getByRole('group', { name: 'Day 1' });
    expect(within(row).getByLabelText('Weekday')).toHaveValue('Mon');
    expect(within(row).getByLabelText('Block')).toHaveValue('Morning');
    await waitFor(() => expect(within(row).getByLabelText('Machine')).toHaveValue('Machine 2'));
    expect(within(dialog).getByLabelText('Starting from')).toHaveValue('2026-10-19');
  });

  it('links a booked cell to the patient page', async () => {
    useCentreUser(['schedule.view', 'patients.view']);
    server.use(
      http.get('*/api/centres/c1/schedule/setup', () => HttpResponse.json(setup)),
      http.get('*/api/centres/c1/schedule/calendar', () => HttpResponse.json(calendar)),
    );
    renderApp(<CalendarPage />);
    const link = await screen.findByRole('link', { name: /Ahmad Nour/ });
    expect(link.getAttribute('href')).toBe('/c/c1/patients/p1');
  });

  it('desktop week runs Saturday to Friday', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({ matches: true, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as unknown as MediaQueryList,
    );
    useCentreUser(['schedule.view', 'patients.view']);
    let from = '';
    server.use(
      http.get('*/api/centres/c1/schedule/setup', () => HttpResponse.json(setup)),
      http.get('*/api/centres/c1/schedule/calendar', ({ request }) => {
        from = new URL(request.url).searchParams.get('from') ?? '';
        const [y, m, d] = from.split('-').map(Number) as [number, number, number];
        const days = Array.from({ length: 7 }, (_, i) => {
          const dt = new Date(y, m - 1, d + i);
          const pad = (n: number) => String(n).padStart(2, '0');
          return { date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`, working: true, blocks: [] };
        });
        return HttpResponse.json({ days });
      }),
    );
    renderApp(<CalendarPage />);
    const heads = await screen.findAllByRole('columnheader');
    const names = heads.map((h) => h.textContent?.split(' ')[0]).filter(Boolean);
    expect(names.slice(0, 7)).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    const [y, m, d] = from.split('-').map(Number) as [number, number, number];
    expect(new Date(y, m - 1, d).getDay()).toBe(6);
    vi.restoreAllMocks();
  });
});
