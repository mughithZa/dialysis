import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { CalendarPage, cellState } from './CalendarPage';
import { STATUS_TONES } from '../../theme';
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

    expect(await screen.findByRole('link', { name: /Ahmad Nour/ })).toBeTruthy();
    // the nurse sits in the block's column header
    const morningHead = screen.getAllByRole('columnheader')[0]!;
    expect(within(morningHead).getByText('Rana')).toBeTruthy();
    // exactly the unrostered block shows the warning
    expect(screen.getAllByText('No nurse')).toHaveLength(1);
    expect(within(screen.getAllByRole('columnheader')[1]!).getByText('No nurse')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Lina Said/ })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Book machine 2, Morning, Oct 19, 2026' }));
    const dialog = await screen.findByRole('dialog');
    const row = within(dialog).getByRole('group', { name: 'Day 1' });
    expect(within(row).getByLabelText('Weekday')).toHaveValue('Mon');
    expect(within(row).getByLabelText('Block')).toHaveValue('Morning');
    await waitFor(() => expect(within(row).getByLabelText('Machine')).toHaveValue('Machine 2'));
    expect(within(dialog).getByLabelText('Starting from')).toHaveValue('2026-10-19');
  });

  it('draws machines x blocks with one coloured tile per cell state', async () => {
    useCentreUser(['schedule.view', 'schedule.book', 'patients.view']);
    const withStatus = (status: string, id: string) => ({ ...card, id, status, patient: { id: `p-${id}`, name: `P ${status}` } });
    const day = {
      date: '2026-10-19',
      working: true,
      blocks: [
        {
          shiftId: 's1',
          nurseByChair: { m1: null, m2: null },
          cells: [
            { chairId: 'm1', session: withStatus('active', 'a'), heldBy: null },
            { chairId: 'm2', session: withStatus('completed', 'b'), heldBy: null },
          ],
        },
        {
          shiftId: 's2',
          nurseByChair: { m1: null, m2: null },
          cells: [
            { chairId: 'm1', session: withStatus('did_not_come', 'c'), heldBy: null },
            { chairId: 'm2', session: null, heldBy: { patientId: 'p9', name: 'Held One' } },
          ],
        },
      ],
    };
    server.use(
      http.get('*/api/centres/c1/schedule/setup', () => HttpResponse.json(setup)),
      http.get('*/api/centres/c1/schedule/calendar', () => HttpResponse.json({ days: [{ ...day, date: '2026-10-19' }] })),
    );
    renderApp(<CalendarPage />);
    const active = await screen.findByRole('link', { name: /P active, Active/ });
    expect(active).toHaveAttribute('data-cell-state', 'active');
    expect(active.getAttribute('style')).toContain(STATUS_TONES.active.bg);
    expect(screen.getByRole('link', { name: /P completed, Completed/ })).toHaveAttribute('data-cell-state', 'completed');
    expect(screen.getByRole('link', { name: /P did_not_come, Did not come/ })).toHaveAttribute('data-cell-state', 'did_not_come');
    const held = screen.getByRole('link', { name: /Held One, Booked/ });
    expect(held).toHaveAttribute('data-cell-state', 'booked');
    expect(held.getAttribute('href')).toBe('/c/c1/patients/p9');
    // rows are machines, columns are blocks
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['1', '2']);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.startsWith('Morning') || h.textContent?.startsWith('Afternoon'))).toEqual([true, true]);
    // legend counts each state
    expect(screen.getByText('Active 1')).toBeTruthy();
    expect(screen.getByText('Booked 1')).toBeTruthy();
  });

  it('maps every session status to a cell state', () => {
    const c = (status: string | null, held = false) => ({
      chairId: 'm1',
      session: status ? ({ ...card, status } as never) : null,
      heldBy: held ? { patientId: 'p', name: 'X' } : null,
    });
    expect(cellState(c('scheduled'))).toEqual({ state: 'booked', tone: 'scheduled' });
    expect(cellState(c(null, true))).toEqual({ state: 'booked', tone: 'scheduled' });
    expect(cellState(c('active')).state).toBe('active');
    expect(cellState(c('completed')).state).toBe('completed');
    expect(cellState(c('did_not_come')).state).toBe('did_not_come');
    expect(cellState(c('missed'))).toEqual({ state: 'did_not_come', tone: 'missed' });
    expect(cellState(c('postponed'))).toEqual({ state: 'postponed', tone: 'postponed' });
    expect(cellState(c('cancelled'))).toEqual({ state: 'postponed', tone: 'cancelled' });
    expect(cellState(c(null))).toEqual({ state: 'free', tone: 'free' });
  });

  it('free cells are a "+" button only for users who can book', async () => {
    useCentreUser(['schedule.view', 'patients.view']);
    server.use(
      http.get('*/api/centres/c1/schedule/setup', () => HttpResponse.json(setup)),
      http.get('*/api/centres/c1/schedule/calendar', () => HttpResponse.json(calendar)),
    );
    renderApp(<CalendarPage />);
    await screen.findByRole('link', { name: /Ahmad Nour/ });
    expect(screen.queryByRole('button', { name: /^Book machine/ })).toBeNull();
    expect(screen.getAllByLabelText(/: free$/)).toHaveLength(2);
  });

  it('steps day by day and jumps back to today', async () => {
    useCentreUser(['schedule.view', 'patients.view']);
    const froms: string[] = [];
    server.use(
      http.get('*/api/centres/c1/schedule/setup', () => HttpResponse.json(setup)),
      http.get('*/api/centres/c1/schedule/calendar', ({ request }) => {
        froms.push(new URL(request.url).searchParams.get('from') ?? '');
        return HttpResponse.json(calendar);
      }),
    );
    renderApp(<CalendarPage />);
    await screen.findByRole('link', { name: /Ahmad Nour/ });
    // the Today button only shows once the user has stepped away from today
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Today' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Today' })).toBeNull());
    expect(new Set(froms).size).toBe(2);
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
