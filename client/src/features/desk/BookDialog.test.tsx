import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { BookDialog } from './BookDialog';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

const setup = {
  machines: ['1', '2', '3', '4', '5', '6'].map((n) => ({ id: `m${n}`, label: n, active: true })),
  blocks: [
    { id: 's1', name: 'Morning', start: '08:00', end: '12:00' },
    { id: 's2', name: 'Afternoon', start: '12:00', end: '16:00' },
  ],
  workingDays: [0, 1, 2, 3, 4, 6],
};

const freeCalls: string[] = [];
const useFree = (free: (p: URLSearchParams) => { id: string; label: string }[]) => {
  freeCalls.length = 0;
  server.use(
    http.get('*/api/centres/c1/schedule/setup', () => HttpResponse.json(setup)),
    http.get('*/api/centres/c1/patients', () => HttpResponse.json([{ id: 'p1', name: 'Ahmad Nour' }])),
    http.get('*/api/centres/c1/schedule/free', ({ request }) => {
      const p = new URL(request.url).searchParams;
      freeCalls.push(p.toString());
      return HttpResponse.json(free(p));
    }),
  );
};

async function choose(scope: HTMLElement, label: string, option: string) {
  await userEvent.click(within(scope).getByLabelText(label));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('BookDialog', () => {
  it('posts a weekly plan with two day rows and no end date', async () => {
    useCentreUser(['schedule.view', 'schedule.book', 'patients.view']);
    useFree((p) => (p.get('shiftId') === 's2' ? [{ id: 'm3', label: '3' }, { id: 'm4', label: '4' }] : [{ id: 'm6', label: '6' }]));
    let body: unknown;
    server.use(
      http.post('*/api/centres/c1/patients/p1/plan', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ plan: {} }, { status: 201 });
      }),
    );
    const onDone = vi.fn();
    renderApp(<BookDialog initial={{ patientId: 'p1', date: '2027-10-18' }} onDone={onDone} />);

    const row1 = await screen.findByRole('group', { name: 'Day 1' });
    await choose(row1, 'Weekday', 'Mon');
    await choose(row1, 'Block', 'Afternoon');
    // only machines from the free list are offered, for the first Monday on or after the start date
    await userEvent.click(within(row1).getByLabelText('Machine'));
    expect(await screen.findByRole('option', { name: 'Machine 4' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Machine 6' })).toBeNull();
    await userEvent.click(screen.getByRole('option', { name: 'Machine 3' }));
    expect(freeCalls).toContain('date=2027-10-18&shiftId=s2&patientId=p1');

    await userEvent.click(screen.getByRole('button', { name: 'Add day' }));
    const row2 = await screen.findByRole('group', { name: 'Day 2' });
    await choose(row2, 'Weekday', 'Wed');
    await choose(row2, 'Block', 'Morning');
    await choose(row2, 'Machine', 'Machine 6');
    expect(freeCalls).toContain('date=2027-10-20&shiftId=s1&patientId=p1');

    await userEvent.click(screen.getByText('Every week, same days and times'));
    await userEvent.click(screen.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(body).toEqual({
      items: [
        { weekday: 1, shiftId: 's2', chairId: 'm3' },
        { weekday: 3, shiftId: 's1', chairId: 'm6' },
      ],
      from: '2027-10-18',
      repeat: 'weekly',
      to: null,
    });
  });

  it('refuses two rows on the same weekday and block', async () => {
    useCentreUser(['schedule.view', 'schedule.book', 'patients.view']);
    useFree(() => [{ id: 'm1', label: '1' }]);
    renderApp(<BookDialog initial={{ patientId: 'p1', date: '2027-10-18', items: [{ weekday: 1, shiftId: 's1', chairId: 'm1' }] }} onDone={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add day' }));
    const row2 = await screen.findByRole('group', { name: 'Day 2' });
    await choose(row2, 'Weekday', 'Mon');
    await choose(row2, 'Block', 'Morning');
    await choose(row2, 'Machine', 'Machine 1');
    expect((await screen.findAllByText('Two days cannot use the same weekday and block.')).length).toBe(2);
    expect(screen.getByRole('button', { name: 'Book' })).toBeDisabled();
  });

  it('on slot_taken refetches the free list, clears the taken machine and shows the message', async () => {
    useCentreUser(['schedule.view', 'schedule.book', 'patients.view']);
    let taken = false;
    useFree(() => (taken ? [{ id: 'm2', label: '2' }] : [{ id: 'm1', label: '1' }, { id: 'm2', label: '2' }]));
    server.use(
      http.post('*/api/centres/c1/patients/p1/plan', () => {
        taken = true;
        return HttpResponse.json({ error: 'slot_taken' }, { status: 409 });
      }),
    );
    renderApp(<BookDialog initial={{ patientId: 'p1', date: '2027-10-18', items: [{ weekday: 1, shiftId: 's1', chairId: 'm1' }] }} onDone={() => {}} />);
    const row = await screen.findByRole('group', { name: 'Day 1' });
    await waitFor(() => expect(within(row).getByLabelText('Machine')).toHaveValue('Machine 1'));
    await userEvent.click(screen.getByRole('button', { name: 'Book' }));
    expect(await screen.findByText('That slot was just taken by another patient.')).toBeTruthy();
    await waitFor(() => expect(within(row).getByLabelText('Machine')).toHaveValue(''));
    expect(screen.getByRole('button', { name: 'Book' })).toBeDisabled();
  });

  it('change mode PUTs the prefilled plan items from the chosen date and passes patientId to free', async () => {
    useCentreUser(['schedule.view', 'schedule.book']);
    useFree(() => [{ id: 'm1', label: '1' }, { id: 'm2', label: '2' }]);
    let body: unknown;
    server.use(
      http.put('*/api/centres/c1/patients/p1/plan', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ plan: {} });
      }),
    );
    const onDone = vi.fn();
    renderApp(
      <BookDialog mode="change" initial={{ patientId: 'p1', date: '2027-10-25', items: [{ weekday: 1, shiftId: 's1', chairId: 'm1' }] }} onDone={onDone} />,
    );
    const row = await screen.findByRole('group', { name: 'Day 1' });
    await waitFor(() => expect(within(row).getByLabelText('Machine')).toHaveValue('Machine 1'));
    await choose(row, 'Machine', 'Machine 2');
    await userEvent.click(screen.getByRole('button', { name: 'Change plan' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(body).toEqual({ items: [{ weekday: 1, shiftId: 's1', chairId: 'm2' }], from: '2027-10-25', to: null });
    expect(freeCalls.some((c) => c.includes('patientId=p1'))).toBe(true);
  });
});
