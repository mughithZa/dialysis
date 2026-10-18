import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ROUTER_FUTURE } from '../routerFuture';
import { server } from '../test/server';
import { AuthProvider, useAuth, useCentre } from './AuthProvider';
import { useCan } from './useCan';

const ME = {
  id: 'u1',
  name: 'Staff',
  kind: 'staff',
  globalPermissions: ['roles.edit'],
  centres: [
    { id: 'c1', name: 'One', permissions: ['patients.view'] },
    { id: 'c2', name: 'Two', permissions: ['users.create'] },
  ],
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter future={ROUTER_FUTURE}>
      <AuthProvider>{children}</AuthProvider>
    </MemoryRouter>
  </QueryClientProvider>
);

describe('useCan / useCentre', () => {
  it('checks global perms, the current centre by default, and an explicit centre', async () => {
    server.use(http.get('*/api/auth/me', () => HttpResponse.json(ME)));
    const { result } = renderHook(
      () => ({
        me: useAuth().me,
        centre: useCentre(),
        view: useCan('patients.view'),
        users: useCan('users.create'),
        usersC2: useCan('users.create', 'c2'),
        roles: useCan('roles.edit'),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.me).not.toBeNull());
    expect(result.current.centre.centreId).toBe('c1');
    expect(result.current.view).toBe(true);
    expect(result.current.users).toBe(false);
    expect(result.current.usersC2).toBe(true);
    expect(result.current.roles).toBe(true);
  });

  it('remembers the chosen centre in localStorage', async () => {
    localStorage.setItem('centreId', 'c2');
    server.use(http.get('*/api/auth/me', () => HttpResponse.json(ME)));
    const { result } = renderHook(() => useCentre(), { wrapper });
    await waitFor(() => expect(result.current.centreId).toBe('c2'));
  });
});
