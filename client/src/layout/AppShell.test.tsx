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
  centres: centres.map((c) => ({ ...c, permissions: ['sessions.view', 'sessions.run', 'patients.view'] })),
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

  it('shows a translated error and stays signed in when logout fails', async () => {
    server.use(
      http.get('*/api/auth/me', () => HttpResponse.json(nurse([{ id: 'c1', name: 'Damascus' }]))),
      http.post('*/api/auth/logout', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    );
    renderApp(<AppRoutes />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('returns to the login page after a successful sign out (found by the e2e run)', async () => {
    let signedOut = false;
    server.use(
      http.get('*/api/auth/me', () =>
        signedOut ? HttpResponse.json({ error: 'unauthenticated' }, { status: 401 }) : HttpResponse.json(nurse([{ id: 'c1', name: 'Damascus' }])),
      ),
      http.post('*/api/auth/logout', () => {
        signedOut = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderApp(<AppRoutes />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Today' })).toBeNull();
  });

  it('redirects an already signed-in user from /login to their landing page', async () => {
    server.use(http.get('*/api/auth/me', () => HttpResponse.json(nurse([{ id: 'c1', name: 'Damascus' }]))));
    renderApp(<AppRoutes />, '/login');
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });
});
