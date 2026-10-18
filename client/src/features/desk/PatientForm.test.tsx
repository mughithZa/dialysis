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
