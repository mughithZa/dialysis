import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { PERMISSIONS } from '@dialysis/shared';
import { RoleEditor } from './RoleEditor';
import type { RoleDto } from './api';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

const role = (over: Partial<RoleDto> = {}): RoleDto => ({
  id: 'r1',
  key: 'custom_1',
  name: 'Nurse',
  scope: 'centre',
  permissions: ['sessions.run'],
  system: false,
  ...over,
});

function useCommon() {
  server.use(
    http.get('*/api/auth/me', () =>
      HttpResponse.json({ id: 'u', name: 'PM', kind: 'staff', globalPermissions: ['roles.edit'], centres: [] }),
    ),
    http.get('*/api/permissions', () => HttpResponse.json(PERMISSIONS.map((p) => ({ key: p.key, category: p.category })))),
  );
}

describe('RoleEditor', () => {
  it('renders categories and PATCHes the role with the ticked permission added', async () => {
    useCommon();
    let body: unknown;
    server.use(
      http.patch('*/api/roles/r1', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(role());
      }),
    );
    renderApp(<RoleEditor role={role()} onDone={() => {}} />);
    expect(await screen.findByText('Sessions')).toBeTruthy();
    await userEvent.click(await screen.findByLabelText('Record medicines and supplies'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('button', { name: 'Save' });
    expect(body).toEqual({ name: 'Nurse', permissions: ['sessions.run', 'sessions.recordUsage'] });
  });

  it('hides global permissions for centre roles and locks program_manager', async () => {
    useCommon();
    const { unmount } = renderApp(<RoleEditor role={role()} onDone={() => {}} />);
    await screen.findByLabelText('Record medicines and supplies');
    expect(screen.queryByLabelText('Create centres')).toBeNull();
    unmount();
    renderApp(
      <RoleEditor
        role={role({ key: 'program_manager', scope: 'global', system: true, permissions: ['centres.create'] })}
        onDone={() => {}}
      />,
    );
    const box = await screen.findByLabelText('Create centres');
    expect((box as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
