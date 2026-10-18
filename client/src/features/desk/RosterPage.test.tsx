import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { RosterPage } from './RosterPage';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

const setup = {
  machines: [
    { id: 'm1', label: 'M1', active: true },
    { id: 'm2', label: 'M2', active: true },
  ],
  blocks: [
    { id: 'b1', name: 'Morning', start: '07:00', end: '11:00' },
    { id: 'b2', name: 'Evening', start: '15:00', end: '19:00' },
  ],
  workingDays: [6, 0, 1, 2, 3, 4],
};
const users = [
  { id: 'n1', username: 'sara', name: 'Sara', phone: null, active: true, roleKeys: ['nurse'] },
  { id: 'd1', username: 'omar', name: 'Dr Omar', phone: null, active: true, roleKeys: ['doctor'] },
];

function mock(entries: unknown[] = [], posts: unknown[] = [], failWith?: string) {
  server.use(
    http.get('*/api/centres/c1/schedule/setup', () => HttpResponse.json(setup)),
    http.get('*/api/centres/c1/users', () => HttpResponse.json(users)),
    http.get('*/api/centres/c1/roster', () => HttpResponse.json(entries)),
    http.post('*/api/centres/c1/roster', async ({ request }) => {
      posts.push(await request.json());
      return failWith ? HttpResponse.json({ error: failWith }, { status: 400 }) : HttpResponse.json([], { status: 201 });
    }),
  );
}

async function fill(period: string, date = '2026-11-02') {
  await userEvent.click(await screen.findByRole('textbox', { name: 'Nurse' }));
  expect(screen.queryByRole('option', { name: 'Dr Omar' })).toBeNull();
  await userEvent.click(await screen.findByRole('option', { name: 'Sara' }));
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: date } });
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Morning' }));
  await userEvent.click(screen.getByRole('radio', { name: period }));
}

describe('RosterPage', () => {
  it('posts Week as date..date+6 with all machines as an empty chairIds', async () => {
    useCentreUser(['schedule.view', 'schedule.assignNurses']);
    const posts: unknown[] = [];
    mock([], posts);
    renderApp(<RosterPage />);
    await fill('Week');
    await userEvent.click(screen.getByRole('button', { name: 'Assign nurse' }));
    await waitFor(() => expect(posts).toEqual([{ nurseId: 'n1', shiftIds: ['b1'], from: '2026-11-02', to: '2026-11-08', chairIds: [] }]));
  });

  it('posts Month as date..date+29, This session as the single date, and chosen machines', async () => {
    useCentreUser(['schedule.view', 'schedule.assignNurses']);
    const posts: unknown[] = [];
    mock([], posts);
    renderApp(<RosterPage />);
    await fill('Month');
    await userEvent.click(screen.getByRole('radio', { name: 'Chosen machines' }));
    await userEvent.click(screen.getByRole('textbox', { name: 'Machines' }));
    await userEvent.click(await screen.findByRole('option', { name: 'M2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Assign nurse' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ nurseId: 'n1', shiftIds: ['b1'], from: '2026-11-02', to: '2026-12-01', chairIds: ['m2'] });
    await userEvent.click(screen.getByRole('radio', { name: 'This session' }));
    await userEvent.click(screen.getByRole('button', { name: 'Assign nurse' }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toMatchObject({ from: '2026-11-02', to: '2026-11-02' });
  });

  it('posts a custom range', async () => {
    useCentreUser(['schedule.view', 'schedule.assignNurses']);
    const posts: unknown[] = [];
    mock([], posts);
    renderApp(<RosterPage />);
    await fill('Custom');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-03' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-10' } });
    await userEvent.click(screen.getByRole('button', { name: 'Assign nurse' }));
    await waitFor(() => expect(posts[0]).toMatchObject({ from: '2026-11-03', to: '2026-11-10' }));
  });

  it('translates a not_a_nurse error', async () => {
    useCentreUser(['schedule.view', 'schedule.assignNurses']);
    mock([], [], 'not_a_nurse');
    renderApp(<RosterPage />);
    await fill('Day');
    await userEvent.click(screen.getByRole('button', { name: 'Assign nurse' }));
    expect(await screen.findByText('That person is not a nurse in this centre.')).toBeInTheDocument();
  });

  it('lists entries grouped by block and deletes after confirming', async () => {
    useCentreUser(['schedule.view', 'schedule.assignNurses']);
    const deleted: string[] = [];
    mock([
      { id: 'e1', nurse: { id: 'n1', name: 'Sara' }, shiftId: 'b1', from: '2026-11-02', to: '2026-11-08', chairs: [] },
      { id: 'e2', nurse: { id: 'n1', name: 'Sara' }, shiftId: 'b2', from: '2026-11-02', to: '2026-11-02', chairs: [{ id: 'm2', label: 'M2' }] },
    ]);
    server.use(
      http.delete('*/api/centres/c1/roster/:id', ({ params }) => {
        deleted.push(String(params.id));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp(<RosterPage />);
    expect(await screen.findByText('M2')).toBeInTheDocument();
    // one in the form's machine toggle, one on the unrestricted entry
    expect(screen.getAllByText('All machines')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: /Morning/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Evening/ })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    expect(deleted).toEqual([]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleted).toEqual(['e1']));
  });

  it('is read-only without schedule.assignNurses', async () => {
    useCentreUser(['schedule.view']);
    mock([{ id: 'e1', nurse: { id: 'n1', name: 'Sara' }, shiftId: 'b1', from: '2026-11-02', to: '2026-11-08', chairs: [] }]);
    renderApp(<RosterPage />);
    await screen.findByText('Sara');
    expect(screen.queryByRole('button', { name: 'Assign nurse' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
