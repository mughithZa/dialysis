import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { CatalogPage, filterItems } from './CatalogPage';
import type { ItemDto } from './api';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

const item = (id: string, name: string, over: Partial<ItemDto> = {}): ItemDto => ({
  id, name, type: 'medicine', unitId: 'u1', status: 'approved', mergedInto: null, used: false, ...over,
});

const ITEMS = [
  item('a', 'Heparin', { status: 'pending' }),
  item('b', 'Heparin sodium'),
  item('c', 'EPO'),
  item('d', 'Heparin old', { status: 'retired' }),
  item('e', 'Gloves', { type: 'supply' }),
];

function useCatalogApi(patches: unknown[] = []) {
  server.use(
    http.get('*/api/auth/me', () =>
      HttpResponse.json({ id: 'u', name: 'PM', kind: 'staff', globalPermissions: ['catalog.manage'], centres: [] }),
    ),
    http.get('*/api/catalog/units', () => HttpResponse.json([{ id: 'u1', name: 'mg' }])),
    http.get('*/api/catalog/items', () => HttpResponse.json(ITEMS)),
    http.patch('*/api/catalog/items/:id', async ({ request, params }) => {
      patches.push({ id: params.id, ...((await request.json()) as object) });
      return HttpResponse.json(ITEMS[0]);
    }),
  );
  return patches;
}

const shownNames = () => [...document.querySelectorAll('[data-item]')].map((r) => r.querySelector('p')?.textContent);

describe('filterItems', () => {
  it('matches the name case-insensitively within the type and leaves out retired items', () => {
    expect(filterItems(ITEMS, 'medicine', 'hep', false).map((i) => i.id)).toEqual(['a', 'b']);
    expect(filterItems(ITEMS, 'medicine', '  HEPARIN ', true).map((i) => i.id)).toEqual(['a']);
    expect(filterItems(ITEMS, 'supply', '', false).map((i) => i.id)).toEqual(['e']);
  });
});

describe('CatalogPage', () => {
  it('filters the list by the search box and the pending chip', async () => {
    useCatalogApi();
    renderApp(<CatalogPage />);
    await screen.findByText('EPO');
    expect(shownNames()).toEqual(['Heparin', 'Heparin sodium', 'EPO']);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search by name' }), 'hep');
    expect(shownNames()).toEqual(['Heparin', 'Heparin sodium']);
    await userEvent.click(screen.getByRole('radio', { name: 'Pending review: 1' }));
    expect(shownNames()).toEqual(['Heparin']);
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search by name' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search by name' }), 'zzz');
    expect(await screen.findByText('No matching items.')).toBeTruthy();
  });

  it('approves a pending item from its row and keeps edit and merge in the row menu', async () => {
    const patches = useCatalogApi();
    renderApp(<CatalogPage />);
    await screen.findByText('EPO');
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(patches).toEqual([{ id: 'a', status: 'approved' }]));
    await userEvent.click(screen.getByRole('button', { name: 'More for EPO' }));
    expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent)).toEqual(['Edit', 'Merge']);
  });
});
