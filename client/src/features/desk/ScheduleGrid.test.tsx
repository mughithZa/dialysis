import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { ScheduleGrid } from './ScheduleGrid';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

const grid = {
  chairs: [
    { id: 'ch1', label: 'Chair 1', active: true },
    { id: 'ch2', label: 'Chair 2', active: true },
    { id: 'ch3', label: 'Chair 3', active: true },
  ],
  shifts: [
    { id: 's1', name: 'Morning', start: '07:00', end: '11:00', active: true },
    { id: 's2', name: 'Evening', start: '15:00', end: '19:00', active: true },
  ],
  slots: [{ chairId: 'ch1', shiftId: 's1', weekday: 1, patient: { id: 'p1', name: 'Ahmad Nour' } }],
};

describe('ScheduleGrid', () => {
  it('shows patients and Free slots, opens BookDialog prefilled, and handles slot_taken', async () => {
    useCentreUser(['schedule.view', 'schedule.book', 'patients.view']);
    let gridCalls = 0;
    server.use(
      http.get('*/api/centres/c1/schedule/grid', () => {
        gridCalls += 1;
        return HttpResponse.json(grid);
      }),
      http.get('*/api/centres/c1/patients', () =>
        HttpResponse.json([{ id: 'p2', name: 'Sami Haddad', status: 'active', phone: null }]),
      ),
      http.post('*/api/centres/c1/patients/p2/pattern', () => HttpResponse.json({ error: 'slot_taken' }, { status: 409 })),
    );
    renderApp(<ScheduleGrid />);
    await userEvent.click(await screen.findByText('Mon'));
    const row1 = await screen.findByTestId('chair-ch1');
    expect(within(row1).getByText('Ahmad Nour')).toBeTruthy();
    await userEvent.click(within(screen.getByTestId('chair-ch3')).getByRole('button', { name: 'Free' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Chair')).toHaveValue('Chair 3');
    expect(within(dialog).getByLabelText('Shift')).toHaveValue('Morning');
    expect(within(dialog).getByRole('checkbox', { name: 'Mon' })).toBeChecked();

    await userEvent.click(within(dialog).getByLabelText('Patient'));
    await userEvent.click(await screen.findByRole('option', { name: 'Sami Haddad' }));
    const before = gridCalls;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Book' }));
    expect(await within(dialog).findByText('That slot was just taken by another patient.')).toBeTruthy();
    await waitFor(() => expect(gridCalls).toBeGreaterThan(before));
  });
});
