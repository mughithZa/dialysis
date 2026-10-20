import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { CatalogPage } from './CatalogPage';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

const item = (id: string, name: string, unitId: string, over: object = {}) => ({
  id, name, type: 'medicine', unitId, status: 'approved', mergedInto: null, used: false, ...over,
});

describe('catalog merge dialog', () => {
  it('lists only same-type same-unit items, excluding itself and retired ones', async () => {
    server.use(
      http.get('*/api/auth/me', () =>
        HttpResponse.json({ id: 'u', name: 'PM', kind: 'staff', globalPermissions: ['catalog.manage'], centres: [] }),
      ),
      http.get('*/api/catalog/units', () => HttpResponse.json([{ id: 'u1', name: 'mg' }, { id: 'u2', name: 'ml' }])),
      http.get('*/api/catalog/items', () =>
        HttpResponse.json([
          item('a', 'Heparin', 'u1', { status: 'pending' }),
          item('b', 'Heparin sodium', 'u1'),
          item('c', 'Heparin liquid', 'u2'),
          item('d', 'Heparin old', 'u1', { status: 'retired' }),
          item('e', 'Gloves', 'u1', { type: 'supply' }),
        ]),
      ),
    );
    renderApp(<CatalogPage />);
    const row = (await screen.findByText('Heparin')).closest('[data-item]') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'More for Heparin' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Merge' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Heparin sodium')).toBeTruthy();
    expect(within(dialog).queryByText('Heparin liquid')).toBeNull();
    expect(within(dialog).queryByText('Heparin old')).toBeNull();
    expect(within(dialog).queryByText('Gloves')).toBeNull();
    expect(within(dialog).queryByText('Heparin')).toBeNull();
  });
});
