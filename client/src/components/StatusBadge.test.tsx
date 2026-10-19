import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from '../test/render';
import { setLanguage } from '../i18n';
import { STATUS_TONES, type StatusTone } from '../theme';
import { StatusBadge } from './StatusBadge';

const LABELS: Record<StatusTone, string> = {
  scheduled: 'Scheduled',
  waiting: 'Waiting',
  active: 'Active',
  completed: 'Completed',
  postponed: 'Postponed',
  missed: 'Missed',
  did_not_come: 'Did not come',
  cancelled: 'Cancelled',
};
const STATUSES = Object.keys(LABELS) as StatusTone[];

afterEach(() => setLanguage('en'));

describe('StatusBadge', () => {
  it('gives every status its own colour pair', () => {
    const pairs = STATUSES.map((s) => `${STATUS_TONES[s].bg}|${STATUS_TONES[s].fg}`);
    expect(new Set(pairs).size).toBe(STATUSES.length);
  });

  it('uses the brief\'s colours: green for active, amber for waiting, red for did not come and missed', () => {
    expect(STATUS_TONES.active.fg).toContain('success');
    expect(STATUS_TONES.waiting.fg).toContain('amber');
    expect(STATUS_TONES.completed.fg).toContain('uoca');
    expect(STATUS_TONES.postponed.fg).toContain('slate');
    expect(STATUS_TONES.did_not_come.fg).toContain('danger');
    expect(STATUS_TONES.missed.bg).toContain('danger');
    expect(STATUS_TONES.cancelled.strike).toBe(true);
  });

  it.each(STATUSES)('renders %s with its label and colours', async (status) => {
    renderApp(<StatusBadge status={status} />);
    const badge = (await screen.findByText(LABELS[status])).closest('[data-status]') as HTMLElement;
    expect(badge).toHaveAttribute('data-status', status);
    expect(badge.getAttribute('style')).toContain(STATUS_TONES[status].bg);
    expect(badge.getAttribute('style')).toContain(STATUS_TONES[status].fg);
  });

  it('strikes through cancelled sessions only', async () => {
    renderApp(
      <>
        <StatusBadge status="cancelled" />
        <StatusBadge status="completed" />
      </>,
    );
    expect((await screen.findByText('Cancelled')).closest('[data-status]')!.getAttribute('style')).toContain('line-through');
    expect(screen.getByText('Completed').closest('[data-status]')!.getAttribute('style') ?? '').not.toContain('line-through');
  });

  it('translates the label', async () => {
    await setLanguage('ar');
    renderApp(<StatusBadge status="waiting" />);
    expect(await screen.findByText('بالانتظار')).toBeInTheDocument();
  });
});
