import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { AssignNursesPage } from './AssignNursesPage';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

const grid = {
  chairs: [
    { id: 'ch1', label: 'Chair 1', active: true },
    { id: 'ch2', label: 'Chair 2', active: true },
  ],
  shifts: [{ id: 's1', name: 'Morning', start: '07:00', end: '11:00', active: true }],
  slots: [],
};

describe('AssignNursesPage', () => {
  it('sends the nurse full chair set for the shift when a chair is assigned', async () => {
    useCentreUser(['schedule.view', 'schedule.assignNurses']);
    const bodies: unknown[] = [];
    server.use(
      http.get('*/api/centres/c1/schedule/grid', () => HttpResponse.json(grid)),
      http.get('*/api/centres/c1/users', () =>
        HttpResponse.json([
          { id: 'n1', username: 'sara', name: 'Sara', phone: null, active: true, roleKeys: ['nurse'] },
          { id: 'd1', username: 'omar', name: 'Dr Omar', phone: null, active: true, roleKeys: ['doctor'] },
        ]),
      ),
      http.get('*/api/centres/c1/assignments', () => HttpResponse.json([{ shiftId: 's1', chairId: 'ch1', nurseId: 'n1' }])),
      http.put('*/api/centres/c1/assignments', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    renderApp(<AssignNursesPage />);
    await screen.findByDisplayValue('Sara');
    await userEvent.click(screen.getByRole('textbox', { name: 'Chair 2' }));
    expect(screen.queryByRole('option', { name: 'Dr Omar' })).toBeNull();
    await userEvent.click(await screen.findByRole('option', { name: 'Sara' }));
    await waitFor(() => expect(bodies).toEqual([{ shiftId: 's1', nurseId: 'n1', chairIds: ['ch1', 'ch2'] }]));
  });

  it('clears a chair by sending the nurse set without it', async () => {
    useCentreUser(['schedule.view', 'schedule.assignNurses']);
    const bodies: unknown[] = [];
    server.use(
      http.get('*/api/centres/c1/schedule/grid', () => HttpResponse.json(grid)),
      http.get('*/api/centres/c1/users', () =>
        HttpResponse.json([{ id: 'n1', username: 'sara', name: 'Sara', phone: null, active: true, roleKeys: ['nurse'] }]),
      ),
      http.get('*/api/centres/c1/assignments', () =>
        HttpResponse.json([
          { shiftId: 's1', chairId: 'ch1', nurseId: 'n1' },
          { shiftId: 's1', chairId: 'ch2', nurseId: 'n1' },
        ]),
      ),
      http.put('*/api/centres/c1/assignments', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    renderApp(<AssignNursesPage />);
    await waitFor(() => expect(screen.getAllByDisplayValue('Sara')).toHaveLength(2));
    await userEvent.click(screen.getByLabelText('Clear Chair 2'));
    await waitFor(() => expect(bodies).toEqual([{ shiftId: 's1', nurseId: 'n1', chairIds: ['ch1'] }]));
  });
});
