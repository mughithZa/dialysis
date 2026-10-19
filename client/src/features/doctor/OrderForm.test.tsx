import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { OrdersPanel } from './OrdersPanel';
import { PatientPage } from '../desk/PatientPage';
import { Route, Routes } from 'react-router-dom';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

interface Stored {
  id: string;
  text: string;
  from: string;
  status: 'active' | 'ended';
  doctor: { id: string; name: string };
}

describe('OrdersPanel', () => {
  it('posts a new order which then appears in the active list, and End removes it', async () => {
    useCentreUser(['orders.view', 'orders.write']);
    const orders: Stored[] = [];
    let posted: unknown;
    server.use(
      http.get('*/api/centres/c1/patients/p1/orders', () => HttpResponse.json(orders)),
      http.post('*/api/centres/c1/patients/p1/orders', async ({ request }) => {
        posted = await request.json();
        const o: Stored = { id: 'o1', text: (posted as { text: string }).text, from: '2026-10-18', status: 'active', doctor: { id: 'd', name: 'Dr Omar' } };
        orders.push(o);
        return HttpResponse.json(o, { status: 201 });
      }),
      http.post('*/api/centres/c1/patients/p1/orders/o1/end', () => {
        orders[0]!.status = 'ended';
        return HttpResponse.json(orders[0]);
      }),
    );
    renderApp(<OrdersPanel patientId="p1" />);
    expect(await screen.findByText('No orders.')).toBeInTheDocument();
    expect(screen.queryByLabelText('New order')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'New order / note' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('New order'), 'Heparin-free until further notice');
    await userEvent.click(dialog.getByRole('button', { name: 'Add order' }));
    expect(await screen.findByText('Heparin-free until further notice')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posted).toEqual({ text: 'Heparin-free until further notice' });
    expect(screen.getByText(/Dr Omar/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'End' }));
    expect(await screen.findByText('No orders.')).toBeInTheDocument();
    // the ended order moves to the folded "Ended orders" list
    const toggle = screen.getByRole('button', { name: /Ended orders/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    const ended = await screen.findByText('Heparin-free until further notice');
    expect(ended.closest('[data-order]')).toHaveAttribute('data-order', 'ended');
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
  });

  it('posts a doctor note which then appears in the notes list', async () => {
    useCentreUser(['orders.view', 'orders.write']);
    const notes: { id: string; at: string; text: string; author: { name: string } }[] = [];
    let posted: unknown;
    server.use(
      http.get('*/api/centres/c1/patients/p1/orders', () => HttpResponse.json([])),
      http.get('*/api/centres/c1/patients/p1/notes', () => HttpResponse.json(notes)),
      http.post('*/api/centres/c1/patients/p1/notes', async ({ request }) => {
        posted = await request.json();
        const n = { id: 'n1', at: new Date().toISOString(), text: (posted as { text: string }).text, author: { name: 'Dr Omar' } };
        notes.push(n);
        return HttpResponse.json(n, { status: 201 });
      }),
    );
    renderApp(<OrdersPanel patientId="p1" />);
    expect(await screen.findByText('No notes.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New order / note' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.click(dialog.getByText('Note'));
    await userEvent.type(dialog.getByLabelText('New note'), 'Review dry weight next week');
    await userEvent.click(dialog.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText('Review dry weight next week')).toBeInTheDocument();
    expect(posted).toEqual({ text: 'Review dry weight next week' });
    expect(screen.getByText(/Dr Omar/)).toBeInTheDocument();
    expect(screen.queryByText('No notes.')).toBeNull();
  });

  it('is read-only with orders.view alone', async () => {
    useCentreUser(['orders.view']);
    server.use(
      http.get('*/api/centres/c1/patients/p1/notes', () =>
        HttpResponse.json([{ id: 'n0', at: '2026-10-01T09:00:00Z', text: 'Old note', author: { name: 'Dr Omar' } }]),
      ),
      http.get('*/api/centres/c1/patients/p1/orders', () =>
        HttpResponse.json([{ id: 'o1', text: 'Low flux', from: '2026-10-01', status: 'active', doctor: { id: 'd', name: 'Dr Omar' } }]),
      ),
    );
    renderApp(<OrdersPanel patientId="p1" />);
    expect(await screen.findByText('Low flux')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New order / note' })).toBeNull();
    expect(await screen.findByText('Old note')).toBeInTheDocument();
  });
});

describe('PatientPage as a doctor', () => {
  it('shows the record and orders but no edit, booking or discharge buttons', async () => {
    useCentreUser(['patients.view', 'sessions.view', 'sessions.viewHistory', 'orders.view', 'orders.write', 'catalog.view', 'catalog.add']);
    server.use(
      http.get('*/api/centres/c1/patients/p1', () =>
        HttpResponse.json({
          id: 'p1',
          userId: 'u1',
          name: 'Ali Hassan',
          phone: null,
          emergencyContact: { name: null, phone: null, relation: null },
          kidneyFailureCause: null,
          address: null,
          socialSituation: null,
          financialSituation: null,
          otherDiseases: null,
          notes: null,
          status: 'active',
          discharge: null,
        }),
      ),
      http.get('*/api/centres/c1/patients/p1/orders', () => HttpResponse.json([])),
      http.get('*/api/centres/c1/patients/p1/notes', () => HttpResponse.json([])),
      http.get('*/api/centres/c1/patients/p1/timeline', () => HttpResponse.json({ upcoming: [], today: [], past: [], notes: [] })),
      http.get('*/api/centres/c1/patients/p1/vitals', () => HttpResponse.json({ points: [] })),
    );
    renderApp(
      <Routes>
        <Route path="/c/:centreId/patients/:patientId" element={<PatientPage />} />
      </Routes>,
      '/c/c1/patients/p1',
    );
    expect(await screen.findByText('Ali Hassan')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('tab', { name: 'Orders' }));
    expect(await screen.findByText('No orders.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New order / note' })).toBeInTheDocument();
    for (const name of ['Edit', 'Book schedule', 'Change schedule', 'Postpone session', 'Make-up session', 'Discharge', 'Transfer to another centre', 'Reset patient password']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });
});
