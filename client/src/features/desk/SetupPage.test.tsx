import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { SetupPage } from './SetupPage';
import { proposeBlocks } from './proposeBlocks';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

describe('proposeBlocks (parity with server/src/schedule/setup.ts)', () => {
  it('splits equally', () => {
    expect(proposeBlocks('08:00', '16:00', 2)).toEqual([
      { name: 'Session 1', start: '08:00', end: '12:00' },
      { name: 'Session 2', start: '12:00', end: '16:00' },
    ]);
  });
  it('rounds down to the minute and the last block ends at day end', () => {
    expect(proposeBlocks('08:00', '17:00', 2)).toEqual([
      { name: 'Session 1', start: '08:00', end: '12:30' },
      { name: 'Session 2', start: '12:30', end: '17:00' },
    ]);
    const b = proposeBlocks('08:00', '17:00', 4);
    expect(b[3]!.end).toBe('17:00');
    expect(b[0]!.end).toBe('10:15');
  });
});

const setup = {
  machines: [
    { id: 'm1', label: '1', active: true },
    { id: 'm2', label: '2', active: true },
  ],
  blocks: [
    { id: 'b1', name: 'Morning', start: '08:00', end: '12:00' },
    { id: 'b2', name: 'Afternoon', start: '12:00', end: '16:00' },
  ],
  workingDays: [0, 1, 2, 3, 4, 6],
};

describe('SetupPage', () => {
  it('proposes blocks, saves the exact body, and translates in_use', async () => {
    useCentreUser(['schedule.view', 'schedule.setup']);
    let body: unknown;
    let status = 409;
    let puts = 0;
    server.use(
      http.get('*/api/centres/c1/schedule/setup', () => HttpResponse.json(setup)),
      http.put('*/api/centres/c1/schedule/setup', async ({ request }) => {
        puts += 1;
        body = await request.json();
        return status === 409 ? HttpResponse.json({ error: 'in_use' }, { status: 409 }) : HttpResponse.json(setup);
      }),
    );
    renderApp(<SetupPage />);
    const count = await screen.findByLabelText('Number of machines');
    await userEvent.clear(count);
    await userEvent.type(count, '3');
    const end = screen.getByLabelText('Day ends');
    await userEvent.clear(end);
    await userEvent.type(end, '17:00');
    const sessions = screen.getByLabelText('Sessions per day');
    await userEvent.clear(sessions);
    await userEvent.type(sessions, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Propose blocks' }));
    expect(screen.getByLabelText('Start of block 2')).toHaveValue('12:30');
    expect(screen.getByLabelText('End of block 2')).toHaveValue('17:00');

    await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(await screen.findByText(/already booked in the future/)).toBeTruthy();
    expect(body).toEqual({
      machineCount: 3,
      blocks: [
        { id: 'b1', name: 'Session 1', start: '08:00', end: '12:30' },
        { id: 'b2', name: 'Session 2', start: '12:30', end: '17:00' },
      ],
      workingDays: [0, 1, 2, 3, 4, 6],
    });
    status = 200;
    await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(puts).toBe(2));
    await waitFor(() => expect(screen.queryByText(/already booked in the future/)).toBeNull());
  });

  it('shows blocks_overlap and edits a machine label via the chair PATCH', async () => {
    useCentreUser(['schedule.view', 'schedule.setup']);
    let patch: unknown;
    server.use(
      http.get('*/api/centres/c1/schedule/setup', () => HttpResponse.json(setup)),
      http.put('*/api/centres/c1/schedule/setup', () => HttpResponse.json({ error: 'blocks_overlap' }, { status: 400 })),
      http.patch('*/api/centres/c1/chairs/m2', async ({ request }) => {
        patch = await request.json();
        return HttpResponse.json({ id: 'm2', label: 'B', active: true });
      }),
    );
    renderApp(<SetupPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save schedule' }));
    expect(await screen.findByText('Session blocks must not overlap.')).toBeTruthy();

    const label = screen.getByLabelText('Label for machine 2');
    await userEvent.clear(label);
    await userEvent.type(label, 'B');
    await userEvent.click(screen.getByRole('button', { name: 'Save label 2' }));
    await waitFor(() => expect(patch).toEqual({ label: 'B' }));
  });
});
