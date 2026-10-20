import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { UsersPage, filterUsers } from './UsersPage';
import type { UserRow } from './api';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

const user = (id: string, name: string, over: Partial<UserRow> = {}): UserRow => ({
  id, username: name.toLowerCase().replace(/\s+/g, '.'), name, phone: null, active: true, roleKeys: ['nurse'], ...over,
});

const USERS = [
  user('1', 'Sara Haddad', { phone: '0991 234 567' }),
  user('2', 'Omar Khatib', { roleKeys: ['front_desk'] }),
  user('3', 'Lina Saleh', { active: false }),
];

function useUsersApi(permissions: string[]) {
  server.use(
    http.get('*/api/auth/me', () =>
      HttpResponse.json({ id: 'u', name: 'Mgr', kind: 'staff', globalPermissions: [], centres: [{ id: 'c1', name: 'Damascus', permissions }] }),
    ),
    http.get('*/api/roles', () =>
      HttpResponse.json([
        { id: 'r1', key: 'nurse', name: 'Nurse', scope: 'centre', permissions: [], system: true },
        { id: 'r2', key: 'front_desk', name: 'Front desk', scope: 'centre', permissions: [], system: true },
      ]),
    ),
    http.get('*/api/centres/c1/users', () => HttpResponse.json(USERS)),
  );
}

const shown = () => [...document.querySelectorAll('[data-user]')].map((r) => r.getAttribute('data-user'));

describe('filterUsers', () => {
  it('matches name, username, phone or role name, and the active filter', () => {
    const role = (k: string) => (k === 'front_desk' ? 'Front desk' : 'Nurse');
    expect(filterUsers(USERS, 'sara', 'all').map((u) => u.id)).toEqual(['1']);
    expect(filterUsers(USERS, '234', 'all').map((u) => u.id)).toEqual(['1']);
    expect(filterUsers(USERS, 'front', 'all', role).map((u) => u.id)).toEqual(['2']);
    expect(filterUsers(USERS, '', 'inactive').map((u) => u.id)).toEqual(['3']);
    expect(filterUsers(USERS, 'nurse', 'active', role).map((u) => u.id)).toEqual(['1']);
  });
});

describe('UsersPage', () => {
  it('filters by the search box and the status chips', async () => {
    useUsersApi(['users.create', 'users.edit', 'users.resetPassword']);
    renderApp(<UsersPage />);
    await screen.findByText('Sara Haddad');
    expect(screen.getByText('3 accounts')).toBeTruthy();
    expect(shown()).toEqual(['sara.haddad', 'omar.khatib', 'lina.saleh']);
    await userEvent.type(screen.getByRole('searchbox', { name: /Search name/ }), 'desk');
    expect(shown()).toEqual(['omar.khatib']);
    await userEvent.clear(screen.getByRole('searchbox', { name: /Search name/ }));
    await userEvent.click(screen.getByRole('radio', { name: 'Inactive' }));
    expect(shown()).toEqual(['lina.saleh']);
    await userEvent.type(screen.getByRole('searchbox', { name: /Search name/ }), 'sara');
    expect(await screen.findByText('No matching users.')).toBeTruthy();
  });

  it('puts edit and reset password in a row menu, by permission', async () => {
    useUsersApi(['users.resetPassword']);
    renderApp(<UsersPage />);
    await screen.findByText('Sara Haddad');
    expect(screen.queryByRole('button', { name: 'New user' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Sara Haddad' }));
    expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent)).toEqual(['Reset password']);
  });

  it('shows no menu without edit or reset permissions', async () => {
    useUsersApi([]);
    renderApp(<UsersPage />);
    await screen.findByText('Sara Haddad');
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });
});
