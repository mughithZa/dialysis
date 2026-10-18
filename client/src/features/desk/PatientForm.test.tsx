import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { PatientForm } from './PatientForm';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

describe('PatientForm', () => {
  it('posts the record and the login for a new patient', async () => {
    useCentreUser(['patients.create']);
    let body: unknown;
    server.use(
      http.post('*/api/centres/c1/patients', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 'p9' }, { status: 201 });
      }),
    );
    renderApp(<PatientForm patient={null} onDone={() => {}} />);
    await userEvent.type(screen.getByLabelText('Full name'), 'Layla Aziz');
    await userEvent.type(screen.getByLabelText('Phone'), '0933');
    await userEvent.type(screen.getByLabelText('Emergency contact name'), 'Omar');
    await userEvent.type(screen.getByLabelText('Cause of kidney failure'), 'Diabetes');
    await userEvent.type(screen.getByLabelText('Login username'), 'layla');
    await userEvent.type(screen.getByLabelText('Login password (min. 8 characters)'), 'password1');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(body).toEqual({
        name: 'Layla Aziz',
        phone: '0933',
        emergencyContact: { name: 'Omar' },
        kidneyFailureCause: 'Diabetes',
        login: { username: 'layla', password: 'password1' },
      }),
    );
  });

  it('editing sends "" for cleared fields so the server clears them', async () => {
    useCentreUser(['patients.edit']);
    let body: unknown;
    server.use(
      http.patch('*/api/centres/c1/patients/p1', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 'p1' });
      }),
    );
    const patient = {
      id: 'p1',
      userId: 'u1',
      name: 'Layla Aziz',
      phone: '0933',
      emergencyContact: { name: 'Omar', phone: '0944', relation: null },
      kidneyFailureCause: null,
      address: null,
      socialSituation: null,
      financialSituation: null,
      otherDiseases: null,
      notes: 'old note',
      status: 'active' as const,
      discharge: null,
    };
    renderApp(<PatientForm patient={patient} onDone={() => {}} />);
    await userEvent.clear(screen.getByLabelText('Phone'));
    await userEvent.clear(screen.getByLabelText('Emergency contact phone'));
    await userEvent.clear(screen.getByLabelText('Notes'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(body).toEqual({
        name: 'Layla Aziz',
        phone: '',
        emergencyContact: { name: 'Omar', phone: '', relation: '' },
        kidneyFailureCause: '',
        address: '',
        socialSituation: '',
        financialSituation: '',
        otherDiseases: '',
        notes: '',
      }),
    );
  });

  it('shows the translated message for a taken username', async () => {
    useCentreUser(['patients.create']);
    server.use(http.post('*/api/centres/c1/patients', () => HttpResponse.json({ error: 'username_taken' }, { status: 409 })));
    renderApp(<PatientForm patient={null} onDone={() => {}} />);
    await userEvent.type(screen.getByLabelText('Full name'), 'Layla Aziz');
    await userEvent.type(screen.getByLabelText('Login username'), 'layla');
    await userEvent.type(screen.getByLabelText('Login password (min. 8 characters)'), 'password1');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('That username is already taken.')).toBeTruthy();
  });
});
