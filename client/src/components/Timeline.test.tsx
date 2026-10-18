import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Timeline } from './Timeline';
import type { TimelineData, TimelineItem } from './timelineApi';
import { renderApp } from '../test/render';
import { server } from '../test/server';
import { useCentreUser } from '../test/auth';
import { addDaysLocal, todayLocal } from '../features/desk/dates';

const item = (id: string, date: string, over: Partial<TimelineItem> = {}): TimelineItem => ({
  id,
  date,
  start: '08:00',
  end: '12:00',
  block: 'Morning',
  chairLabel: '3',
  centreId: 'c1',
  centreName: 'Damascus',
  status: 'scheduled',
  kind: 'regular',
  detached: false,
  oneOff: false,
  nurse: null,
  medicines: [],
  linkable: true,
  ...over,
});
const data = (over: Partial<TimelineData> = {}): TimelineData => ({ upcoming: [], today: [], past: [], notes: [], ...over });
const serve = (body: TimelineData | ((before: string | null) => TimelineData), path = '*/api/centres/c1/patients/p1/timeline') =>
  server.use(
    http.get(path, ({ request }) => {
      const before = new URL(request.url).searchParams.get('before');
      return HttpResponse.json(typeof body === 'function' ? body(before) : body);
    }),
  );
const staff = { kind: 'staff', centreId: 'c1', patientId: 'p1' } as const;

describe('Timeline', () => {
  it('renders Upcoming, Today and Past with row details and status badges', async () => {
    useCentreUser(['sessions.view']);
    serve(
      data({
        upcoming: [item('u1', addDaysLocal(2), { nurse: { name: 'Huda' } })],
        today: [item('t1', todayLocal(), { status: 'active' })],
        past: [
          item('p1', '2026-10-01', { status: 'completed', medicines: [{ name: 'Heparin', amount: 5, unit: 'cc' }], nurse: { name: 'Rana' } }),
          item('p2', '2026-09-30', { status: 'did_not_come' }),
          item('p3', '2026-09-29', { status: 'cancelled', statusReason: 'Hospital admission' }),
          item('p4', '2026-09-28', { status: 'postponed' }),
          item('p5', '2026-09-27', { status: 'missed' }),
          item('p6', '2026-09-26', { status: 'completed', kind: 'makeup', detached: true, oneOff: true }),
        ],
      }),
    );
    renderApp(<Timeline source={staff} />);
    expect(await screen.findByRole('heading', { name: 'Upcoming' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Today' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Past' })).toBeVisible();

    const up = within(screen.getByTestId('timeline-row-u1'));
    expect(up.getByText('Scheduled')).toBeVisible();
    expect(up.getByText(/Morning · 08:00–12:00/)).toBeVisible();
    expect(up.getByText(/Machine 3/)).toBeVisible();
    expect(up.getByText(/Huda/)).toBeVisible();
    expect(within(screen.getByTestId('timeline-row-t1')).getByText('Active')).toBeVisible();

    const done = within(screen.getByTestId('timeline-row-p1'));
    expect(done.getByText('Completed')).toBeVisible();
    expect(done.getByText(/Heparin: 5 cc/)).toBeVisible();
    expect(done.getByText(/Rana/)).toBeVisible();
    expect(within(screen.getByTestId('timeline-row-p2')).getByText('Did not come')).toBeVisible();
    const cancelled = within(screen.getByTestId('timeline-row-p3'));
    expect(cancelled.getByText('Cancelled')).toBeVisible();
    expect(cancelled.getByText('Hospital admission')).toBeVisible();
    expect(within(screen.getByTestId('timeline-row-p4')).getByText('Postponed')).toBeVisible();
    expect(within(screen.getByTestId('timeline-row-p5')).getByText('Missed')).toBeVisible();
    const marked = within(screen.getByTestId('timeline-row-p6'));
    expect(marked.getByText('Make-up')).toBeVisible();
    expect(marked.getByText('Moved')).toBeVisible();
    expect(marked.getByText('One-off')).toBeVisible();
  });

  it('links a row to its session only when linkable', async () => {
    useCentreUser(['sessions.view']);
    serve(
      data({
        past: [
          item('s9', '2026-10-10', { status: 'completed' }),
          item('s8', '2026-09-01', { status: 'completed', centreId: 'c2', centreName: 'Aleppo', linkable: false }),
        ],
      }),
    );
    renderApp(<Timeline source={staff} />);
    const own = within(await screen.findByTestId('timeline-row-s9'));
    expect(own.getByRole('link')).toHaveAttribute('href', '/c/c1/sessions/s9');
    const other = within(screen.getByTestId('timeline-row-s8'));
    expect(other.queryByRole('link')).toBeNull();
    expect(other.getByText(/Aleppo/)).toBeVisible();
  });

  it("shows the patient's own timeline without notes or links when notes are absent", async () => {
    serve(data({ upcoming: [item('u1', addDaysLocal(1), { linkable: undefined })], past: [item('p1', '2026-10-01', { status: 'completed', linkable: undefined })] }), '*/api/me/timeline');
    renderApp(<Timeline source={{ kind: 'me' }} />);
    expect(await screen.findByTestId('timeline-row-u1')).toBeVisible();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Doctor note')).toBeNull();
  });

  it("shows a session's nurse notes and the doctor's orders under its row when the patient may see them", async () => {
    serve(
      data({
        past: [
          item('p1', '2026-10-01', {
            status: 'completed',
            linkable: undefined,
            notes: [{ at: '2026-10-01T09:00:00.000Z', text: 'felt dizzy' }],
            orders: [{ text: 'no heparin', from: '2026-09-25' }],
          }),
          item('p2', '2026-09-30', { status: 'completed', linkable: undefined }),
        ],
      }),
      '*/api/me/timeline',
    );
    renderApp(<Timeline source={{ kind: 'me' }} />);
    const row = within(await screen.findByTestId('timeline-row-p1'));
    expect(row.getByText('Nurse notes')).toBeVisible();
    expect(row.getByText('felt dizzy')).toBeVisible();
    expect(row.getByText("Doctor's orders")).toBeVisible();
    expect(row.getByText(/no heparin/)).toBeVisible();
    const plain = within(screen.getByTestId('timeline-row-p2'));
    expect(plain.queryByText('Nurse notes')).toBeNull();
    expect(plain.queryByText("Doctor's orders")).toBeNull();
  });

  it('interleaves notes with sessions by date, newest first', async () => {
    useCentreUser(['sessions.view']);
    serve(
      data({
        past: [item('a', '2026-10-05', { status: 'completed' }), item('b', '2026-10-01', { status: 'completed' })],
        notes: [{ id: 'n1', at: new Date(2026, 9, 3, 10, 0).toISOString(), text: 'Reduce fluid intake', author: { name: 'Dr Omar' } }],
      }),
    );
    renderApp(<Timeline source={staff} />);
    const note = await screen.findByText('Reduce fluid intake');
    expect(screen.getByText('Doctor note')).toBeVisible();
    expect(screen.getByText(/Dr Omar/)).toBeVisible();
    const order = [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid'));
    expect(order).toEqual(['timeline-row-a', 'timeline-note-n1', 'timeline-row-b']);
    expect(note).toBeVisible();
  });

  it('renders the actions prop for each row', async () => {
    useCentreUser(['sessions.view']);
    serve(data({ upcoming: [item('u1', addDaysLocal(1))] }));
    renderApp(<Timeline source={staff} actions={(i) => <button>Act on {i.id}</button>} />);
    expect(await screen.findByRole('button', { name: 'Act on u1' })).toBeVisible();
  });

  it('loads more using the day after the oldest date as before, without duplicating rows', async () => {
    useCentreUser(['sessions.view']);
    const befores: Array<string | null> = [];
    const page1 = Array.from({ length: 20 }, (_, i) => item(`r${i}`, `2026-09-${String(30 - i).padStart(2, '0')}`, { status: 'completed' }));
    serve((before) => {
      befores.push(before);
      return data({ past: before ? [page1[19]!, item('old', '2026-08-01', { status: 'completed' })] : page1 });
    });
    renderApp(<Timeline source={staff} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByTestId('timeline-row-old')).toBeVisible();
    expect(befores[1]).toBe('2026-09-12');
    expect(screen.getAllByTestId('timeline-row-r19')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('says so when there is nothing yet', async () => {
    useCentreUser(['sessions.view']);
    serve(data());
    renderApp(<Timeline source={staff} />);
    expect(await screen.findByText('No sessions yet.')).toBeVisible();
  });
});
