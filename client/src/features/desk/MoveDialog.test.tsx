import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MoveDialog } from './MoveDialog';
import { CancelDialog } from './CancelDialog';
import { todayLocal } from './dates';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

const setup = {
  machines: [
    { id: 'm1', label: '1', active: true },
    { id: 'm2', label: '2', active: true },
  ],
  blocks: [{ id: 's1', name: 'Morning', start: '08:00', end: '12:00' }],
  workingDays: [0, 1, 2, 3, 4, 6],
};

describe('MoveDialog', () => {
  it('lists free machines for the date and block, posts the move and closes', async () => {
    useCentreUser(['schedule.view', 'schedule.book']);
    let body: unknown;
    let query = '';
    server.use(
      http.get('*/api/centres/c1/schedule/setup', () => HttpResponse.json(setup)),
      http.get('*/api/centres/c1/schedule/free', ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json([{ id: 'm2', label: '2' }]);
      }),
      http.post('*/api/centres/c1/sessions/x1/move', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    const onDone = vi.fn();
    renderApp(<MoveDialog sessionId="x1" date="2099-01-05" onDone={onDone} />);
    expect(screen.getByLabelText('Date')).toHaveAttribute('min', todayLocal());
    await userEvent.click(await screen.findByRole('textbox', { name: 'Block' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Morning' }));
    await userEvent.click(screen.getByRole('textbox', { name: 'Machine' }));
    expect(await screen.findByRole('option', { name: 'Machine 2' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Machine 1' })).toBeNull();
    await userEvent.click(screen.getByRole('option', { name: 'Machine 2' }));
    expect(query).toBe('?date=2099-01-05&shiftId=s1');
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(body).toEqual({ date: '2099-01-05', shiftId: 's1', chairId: 'm2' });
  });
});

describe('CancelDialog', () => {
  it('requires a reason, then posts it', async () => {
    useCentreUser(['sessions.postpone']);
    let body: unknown;
    server.use(
      http.post('*/api/centres/c1/sessions/x1/cancel', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    const onDone = vi.fn();
    renderApp(<CancelDialog sessionId="x1" onDone={onDone} />);
    const submit = screen.getByRole('button', { name: 'Cancel session' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason'), 'Hospital admission');
    await userEvent.click(submit);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(body).toEqual({ reason: 'Hospital admission' });
  });
});
