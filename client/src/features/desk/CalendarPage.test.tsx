import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
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
      http.get('*/api/centres/c1/schedule/grid', () =>
        HttpResponse.json({
          chairs: setup.machines,
          shifts: setup.blocks.map((b) => ({ ...b, active: true })),
          slots: [],
        }),
      ),
      http.get('*/api/centres/c1/patients', () => HttpResponse.json([])),
    );
    renderApp(<CalendarPage />);

    expect(await screen.findByText('Ahmad Nour')).toBeTruthy();
    expect(screen.getByText('Rana')).toBeTruthy();
    // exactly the unrostered block shows the warning
    expect(screen.getAllByText('No nurse')).toHaveLength(1);
    expect(screen.getByText('Lina Said')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Empty: machine 2, Morning, 2026-10-19' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Chair')).toHaveValue('2');
    expect(within(dialog).getByLabelText('Shift')).toHaveValue('Morning');
    expect(within(dialog).getByRole('checkbox', { name: 'Mon' })).toBeChecked();
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
});
