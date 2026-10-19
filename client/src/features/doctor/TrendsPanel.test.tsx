import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { TrendsPanel, trendStats } from './TrendsPanel';
import type { VitalsPoint } from './api';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';
import i18n from '../../i18n';

const point = (date: string, over: Partial<VitalsPoint> = {}): VitalsPoint => ({
  sessionId: date,
  date,
  centreName: 'North',
  weightBefore: null,
  weightAfter: null,
  weightLoss: null,
  systolic: null,
  diastolic: null,
  bpCount: 0,
  ...over,
});

const POINTS = [
  point('2026-10-10', { weightBefore: 72, weightAfter: 70, weightLoss: 2, systolic: 140, diastolic: 90, bpCount: 2 }),
  point('2026-10-12', { weightBefore: 73, weightAfter: 70.5, weightLoss: 2.5, systolic: 128, diastolic: 82, bpCount: 1 }),
  point('2026-10-14', { weightBefore: 71.5 }),
];

const statValue = (label: string) => {
  const card = screen.getByText(label).closest('[data-stat-card]') as HTMLElement;
  return within(card);
};

describe('trendStats', () => {
  it('takes the latest weight (after, else before), the average loss and the latest BP', () => {
    expect(trendStats(POINTS)).toEqual({ lastWeight: 71.5, avgLoss: 2.3, lastBp: { systolic: 128, diastolic: 82 } });
    expect(trendStats([])).toEqual({ lastWeight: null, avgLoss: null, lastBp: null });
  });
});

describe('TrendsPanel', () => {
  it('shows the key numbers above the three charts', async () => {
    useCentreUser(['sessions.view', 'orders.write']);
    server.use(http.get('*/api/centres/c1/patients/p1/vitals', ({ request }) => {
      expect(new URL(request.url).searchParams.get('limit')).toBe('30');
      return HttpResponse.json({ points: POINTS });
    }));
    renderApp(<TrendsPanel patientId="p1" />);
    expect(await screen.findByText('Last weight')).toBeVisible();
    expect(statValue('Last weight').getByText('71.5 kg')).toBeVisible();
    expect(statValue('Avg. weight loss (UF)').getByText('2.3 kg')).toBeVisible();
    expect(statValue('Last blood pressure').getByText('128/82')).toBeVisible();
    expect(screen.getByText('Sessions with recorded vitals: 3')).toBeVisible();
    for (const title of ['Weight before and after (kg)', 'Weight loss per session (kg)', 'Blood pressure, session average (mmHg)']) {
      expect(screen.getByText(title)).toBeVisible();
    }
  });

  it('shows dashes for numbers it cannot work out', async () => {
    useCentreUser(['sessions.view', 'orders.write']);
    server.use(http.get('*/api/centres/c1/patients/p1/vitals', () => HttpResponse.json({ points: [point('2026-10-14', { weightBefore: 70 })] })));
    renderApp(<TrendsPanel patientId="p1" />);
    expect(await screen.findByText('Last weight')).toBeVisible();
    expect(statValue('Last weight').getByText('70 kg')).toBeVisible();
    expect(statValue('Avg. weight loss (UF)').getByText('—')).toBeVisible();
    expect(statValue('Last blood pressure').getByText('—')).toBeVisible();
  });

  it('shows an empty state when no vitals were recorded', async () => {
    useCentreUser(['sessions.view', 'orders.write']);
    server.use(http.get('*/api/centres/c1/patients/p1/vitals', () => HttpResponse.json({ points: [] })));
    renderApp(<TrendsPanel patientId="p1" />);
    expect(await screen.findByText('No vitals recorded yet.')).toBeVisible();
    expect(screen.queryByText('Last weight')).toBeNull();
  });

  it('reads in Arabic', async () => {
    useCentreUser(['sessions.view', 'orders.write']);
    server.use(http.get('*/api/centres/c1/patients/p1/vitals', () => HttpResponse.json({ points: POINTS })));
    await i18n.changeLanguage('ar');
    try {
      renderApp(<TrendsPanel patientId="p1" />);
      expect(await screen.findByText('آخر وزن')).toBeVisible();
      expect(screen.getByText('71.5 كغ')).toBeVisible();
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
