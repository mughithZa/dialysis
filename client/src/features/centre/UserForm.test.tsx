import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { UserForm } from './UserForm';
import { SettingsPage } from './SettingsPage';
import { AuditPage } from './AuditPage';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

const useCentreUser = (permissions: string[]) =>
  server.use(
    http.get('*/api/auth/me', () =>
      HttpResponse.json({ id: 'u', name: 'Mgr', kind: 'staff', globalPermissions: [], centres: [{ id: 'c1', name: 'Damascus', permissions }] }),
    ),
    http.get('*/api/roles', () =>
      HttpResponse.json([
        { id: 'r1', key: 'nurse', name: 'Nurse', scope: 'centre', permissions: [], system: true },
        { id: 'r2', key: 'program_manager', name: 'Program manager', scope: 'global', permissions: [], system: true },
      ]),
    ),
  );

describe('UserForm', () => {
  it('shows the translated message when the server answers 403 cannot_grant', async () => {
    useCentreUser(['users.create']);
    server.use(http.post('*/api/centres/c1/users', () => HttpResponse.json({ error: 'cannot_grant' }, { status: 403 })));
    renderApp(<UserForm user={null} onDone={() => {}} />);
    expect(await screen.findByLabelText('Nurse')).toBeTruthy();
    expect(screen.queryByLabelText('Program manager')).toBeNull();
    await userEvent.type(screen.getByLabelText(/^Full name/), 'Sara');
    await userEvent.type(screen.getByLabelText(/^Username/), 'sara');
    await userEvent.type(screen.getByLabelText(/^Password/), 'password1');
    await userEvent.click(screen.getByLabelText('Nurse'));
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('You cannot grant one of those roles.')).toBeTruthy();
  });

  it('looks up a doctor by phone and links them with the chosen roles', async () => {
    useCentreUser(['users.create']);
    let linked: { id: string; body: unknown } | undefined;
    server.use(
      http.get('*/api/centres/c1/users/lookup', ({ request }) => {
        expect(new URL(request.url).searchParams.get('phone')).toBe('0911');
        return HttpResponse.json([{ id: 'd1', name: 'Dr Omar' }]);
      }),
      http.post('*/api/centres/c1/users/d1/link', async ({ request }) => {
        linked = { id: 'd1', body: await request.json() };
        return HttpResponse.json({ id: 'd1' });
      }),
    );
    renderApp(<UserForm user={null} onDone={() => {}} />);
    await screen.findByLabelText('Nurse');
    await userEvent.type(screen.getByLabelText('Doctor phone'), '0911');
    await userEvent.click(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByText('Dr Omar')).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Nurse'));
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(linked).toEqual({ id: 'd1', body: { roleKeys: ['nurse'] } }));
  });
});

describe('UserForm (edit)', () => {
  const existing = { id: 'n1', username: 'nina', name: 'Nina', phone: '0911', active: true, roleKeys: ['nurse'] };

  it('does not send roleKeys when the selection is unchanged', async () => {
    useCentreUser(['users.edit', 'roles.assign']);
    const bodies: unknown[] = [];
    server.use(
      http.patch('*/api/centres/c1/users/n1', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(existing);
      }),
    );
    renderApp(<UserForm user={existing} onDone={() => {}} />);
    await screen.findByLabelText('Nurse');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toEqual([{ name: 'Nina', phone: '0911', active: true }]));
  });

  it('requires at least one role when roles are shown', async () => {
    useCentreUser(['users.edit', 'roles.assign']);
    renderApp(<UserForm user={existing} onDone={() => {}} />);
    await userEvent.click(await screen.findByLabelText('Nurse'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it.each([
    ['not_home_centre', 403, 'Only this person’s home centre can change that.'],
    ['cannot_deactivate_self', 400, 'You cannot deactivate your own account.'],
  ])('translates %s', async (code, status, message) => {
    useCentreUser(['users.edit']);
    server.use(http.patch('*/api/centres/c1/users/n1', () => HttpResponse.json({ error: code }, { status })));
    renderApp(<UserForm user={existing} onDone={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText(message)).toBeTruthy();
  });
});

describe('SettingsPage', () => {
  it('blocks reminder hours outside 1-72 and saves a valid value', async () => {
    useCentreUser(['settings.centre']);
    const bodies: unknown[] = [];
    server.use(
      http.get('*/api/centres/c1/settings', () => HttpResponse.json({ patientsSeeNotes: false, reminderHours: 24 })),
      http.patch('*/api/centres/c1/settings', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ patientsSeeNotes: false, reminderHours: 48 });
      }),
    );
    renderApp(<SettingsPage />);
    const hours = await screen.findByLabelText('Reminder hours before a session');
    await screen.findByDisplayValue('24');
    await userEvent.clear(hours);
    await userEvent.type(hours, '100');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Enter a whole number from 1 to 72.')).toBeTruthy();
    expect(bodies).toEqual([]);
    await userEvent.clear(hours);
    await userEvent.type(hours, '48');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toEqual([{ patientsSeeNotes: false, reminderHours: 48 }]));
  });
});

describe('AuditPage', () => {
  it('sends userId when a user filter is chosen', async () => {
    useCentreUser(['audit.view', 'users.create']);
    const seen: (string | null)[] = [];
    server.use(
      http.get('*/api/centres/c1/users', () =>
        HttpResponse.json([{ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', username: 'sara', name: 'Sara', phone: null, active: true, roleKeys: [] }]),
      ),
      http.get('*/api/centres/c1/audit', ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('userId'));
        return HttpResponse.json([
          { at: '2026-10-01T08:00:00.000Z', user: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Sara' }, action: 'user.create', entity: 'user', entityId: 'x', details: {} },
        ]);
      }),
    );
    renderApp(<AuditPage />);
    await screen.findByText('User created');
    expect(seen[0]).toBeNull();
    await userEvent.click(screen.getByRole('textbox', { name: 'User' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Sara' }));
    await screen.findByText('User created');
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.at(-1)).toBe('aaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('labels actions in words, groups them by day and filters by the search box', async () => {
    useCentreUser(['audit.view']);
    server.use(
      http.get('*/api/centres/c1/audit', () =>
        HttpResponse.json([
          { at: '2026-10-02T09:00:00.000Z', user: { id: 'a', name: 'Sara' }, action: 'session.open', entity: 'session', entityId: 'x', details: {} },
          { at: '2026-10-01T08:00:00.000Z', user: { id: 'b', name: 'Omar' }, action: 'patient.create', entity: 'patient', entityId: 'y', details: {} },
          { at: '2026-10-01T07:00:00.000Z', user: { id: 'b', name: 'Omar' }, action: 'brand.new', entity: 'x', entityId: 'z', details: {} },
        ]),
      ),
    );
    renderApp(<AuditPage />);
    await screen.findByText('Session started');
    expect(screen.getByText('Patient registered')).toBeTruthy();
    expect(screen.getByText('brand.new')).toBeTruthy(); // unknown actions show as they are
    expect(screen.getByText('Oct 2, 2026')).toBeTruthy();
    expect(screen.getByText('Oct 1, 2026')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'User' })).toBeNull(); // no user list without users.create/edit
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search action or person' }), 'omar');
    expect(document.querySelectorAll('[data-audit-row]')).toHaveLength(2);
    expect(screen.queryByText('Session started')).toBeNull();
  });
});
