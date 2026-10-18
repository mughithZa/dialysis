import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { TodayPage } from './TodayPage';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

const card = (id: string, patient: string, chair: string, over: Record<string, unknown> = {}) => ({
  id,
  date: '2026-10-18',
  status: 'scheduled',
  kind: 'regular',
  chair: { id: `c${id}`, label: chair },
  shift: { id: 'sh', name: 'Morning', start: '07:00', end: '11:00' },
  patient: { id: `p${id}`, name: patient },
  hasActiveOrders: false,
  ...over,
});

describe('TodayPage', () => {
  it('groups cards into My chairs, Unassigned and Other chairs (collapsed)', async () => {
    useCentreUser(['sessions.view', 'sessions.run']);
    server.use(
      http.get('*/api/centres/c1/today', () =>
        HttpResponse.json({
          mine: [card('1', 'Layla', 'Chair 1', { hasActiveOrders: true, status: 'active' })],
          unassigned: [card('2', 'Omar', 'Chair 2')],
          others: [card('3', 'Huda', 'Chair 3')],
        }),
      ),
    );
    renderApp(<TodayPage />);
    expect(await screen.findByRole('button', { name: /My chairs/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unassigned/ })).toBeInTheDocument();
    expect(screen.getByText('Layla')).toBeVisible();
    expect(screen.getByText('In progress')).toBeVisible();
    expect(screen.getByText('Orders')).toBeVisible();
    expect(screen.getByText('Omar')).toBeVisible();
    expect(screen.getByText('Huda')).not.toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Other chairs/ }));
    expect(await screen.findByText('Huda')).toBeVisible();
  });
});
