import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MakeupDialog } from './MakeupDialog';
import { addDaysLocal, todayLocal } from './dates';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

describe('MakeupDialog', () => {
  it('limits the date to today through the 3-day make-up window', async () => {
    useCentreUser(['schedule.makeup', 'schedule.view']);
    server.use(http.get('*/api/centres/c1/schedule/setup', () => HttpResponse.json({ machines: [], blocks: [], workingDays: [] })));
    renderApp(<MakeupDialog patientId="p1" onDone={() => {}} />);
    const date = screen.getByLabelText('Date');
    expect(date).toHaveAttribute('min', todayLocal());
    expect(date).toHaveAttribute('max', addDaysLocal(3));
  });

  it('links the make-up to the session it replaces', async () => {
    useCentreUser(['schedule.makeup', 'schedule.view']);
    let body: unknown;
    server.use(
      http.get('*/api/centres/c1/schedule/setup', () =>
        HttpResponse.json({
          machines: [{ id: 'm1', label: '1', active: true }],
          blocks: [{ id: 'b1', name: 'Morning', start: '08:00', end: '12:00' }],
          workingDays: [0, 1, 2, 3, 4, 5, 6],
        }),
      ),
      http.post('*/api/centres/c1/patients/p1/makeup', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    renderApp(<MakeupDialog patientId="p1" forSessionId="s9" onDone={() => {}} />);
    await userEvent.click(await screen.findByRole('textbox', { name: 'Chair' }));
    await userEvent.click(await screen.findByRole('option', { name: '1' }));
    await userEvent.click(screen.getByRole('textbox', { name: 'Shift' }));
    await userEvent.click(await screen.findByRole('option', { name: /Morning/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(body).toEqual({ date: todayLocal(), chairId: 'm1', shiftId: 'b1', forSessionId: 's9' }));
  });
});
