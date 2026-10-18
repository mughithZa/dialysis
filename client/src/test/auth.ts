import { http, HttpResponse } from 'msw';
import { server } from './server';

/** Signs the test user in as staff of centre `c1` holding exactly these permissions. */
export const useCentreUser = (permissions: string[]) =>
  server.use(
    http.get('*/api/auth/me', () =>
      HttpResponse.json({ id: 'u', name: 'Desk', kind: 'staff', globalPermissions: [], centres: [{ id: 'c1', name: 'Damascus', permissions }] }),
    ),
  );
