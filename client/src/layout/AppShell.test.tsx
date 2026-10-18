import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { AppRoutes } from '../App';
import { renderApp } from '../test/render';
import { server } from '../test/server';

const nurse = (centres: { id: string; name: string }[]) => ({
  id: 'u1',
  name: 'Nurse',
  kind: 'staff',
  globalPermissions: [],
  centres: centres.map((c) => ({ ...c, permissions: ['sessions.run', 'patients.view'] })),
});

describe('AppShell', () => {
  it('lands a nurse on today with side navigation and no centre switcher for a single centre', async () => {
    server.use(http.get('*/api/auth/me', () => HttpResponse.json(nurse([{ id: 'c1', name: 'Damascus' }]))));
    renderApp(<AppRoutes />);
    const nav = (await screen.findAllByRole('navigation'))[0]!;
    expect(await within(nav).findByText('Patients')).toBeTruthy();
    expect(screen.getAllByText('Today').length).toBeGreaterThan(0);
    expect(screen.queryAllByLabelText('Centre')).toHaveLength(0);
  });

  it('shows a centre switcher when the user has more than one centre', async () => {
    server.use(
      http.get('*/api/auth/me', () =>
        HttpResponse.json(
          nurse([
            { id: 'c1', name: 'Damascus' },
            { id: 'c2', name: 'Aleppo' },
          ]),
        ),
      ),
    );
    renderApp(<AppRoutes />);
    const switcher = (await screen.findAllByLabelText('Centre'))[0]!;
    await userEvent.click(switcher);
    expect(await screen.findByRole('option', { name: 'Aleppo' })).toBeTruthy();
  });

  it('redirects to the login page when not signed in', async () => {
    server.use(http.get('*/api/auth/me', () => HttpResponse.json({ error: 'unauthenticated' }, { status: 401 })));
    renderApp(<AppRoutes />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
});
