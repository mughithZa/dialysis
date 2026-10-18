import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderApp } from '../test/render';
import { LoginPage } from './LoginPage';

const unauthenticated = http.get('*/api/auth/me', () =>
  HttpResponse.json({ error: 'unauthenticated' }, { status: 401 }),
);

async function submit(user: string, pass: string) {
  await userEvent.type(await screen.findByLabelText(/^Username/), user);
  await userEvent.type(screen.getByLabelText(/^Password/), pass);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage', () => {
  it('shows a translated error on bad credentials', async () => {
    server.use(
      unauthenticated,
      http.post('*/api/auth/login', () => HttpResponse.json({ error: 'bad_credentials' }, { status: 401 })),
    );
    renderApp(<LoginPage />);
    await submit('pm', 'wrong');
    expect(await screen.findByText('Incorrect username or password.')).toBeInTheDocument();
  });

  it('falls back to the generic message for unknown error codes', async () => {
    server.use(
      unauthenticated,
      http.post('*/api/auth/login', () => HttpResponse.json({ error: 'weird_code' }, { status: 500 })),
    );
    renderApp(<LoginPage />);
    await submit('pm', 'x');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('redirects a nurse to today after login', async () => {
    const me = {
      id: 'u1',
      name: 'Nurse',
      kind: 'staff',
      globalPermissions: [],
      centres: [{ id: 'c1', name: 'One', permissions: ['sessions.view', 'sessions.run'] }],
    };
    server.use(
      unauthenticated,
      http.post('*/api/auth/login', () => HttpResponse.json({ user: me })),
    );
    renderApp(
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/c/:centreId/today" element={<div>TODAY PAGE</div>} />
      </Routes>,
    );
    await submit('nurse', 'pw');
    await waitFor(() => expect(screen.getByText('TODAY PAGE')).toBeInTheDocument());
  });
});
