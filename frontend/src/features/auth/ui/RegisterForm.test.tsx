import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks, useSession } from '@/entities/user';
import { RegisterForm } from './RegisterForm';

// Attached once at module scope — see authApi.test.ts for why attaching this
// inside beforeEach would stack interceptors across the tests in this file
// and corrupt the ApiError status on every test after the first.
attachAuthInterceptors(httpClient, sessionAuthHooks);

let mock: MockAdapter;

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/register', element: <RegisterForm /> },
      { path: '/login', element: <p>login screen</p> },
      { path: '/', element: <p>dashboard</p> },
    ],
    { initialEntries: ['/register'] },
  );
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('RegisterForm', () => {
  beforeEach(() => {
    useSession.setState({ token: null });
    mock = new MockAdapter(httpClient);
  });
  afterEach(() => mock.restore());

  it('stores the token and navigates on success', async () => {
    mock.onPost('/auth/register').reply(200, { access_token: 'tok' });
    renderForm();

    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2!!');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('dashboard')).toBeInTheDocument();
    expect(useSession.getState().token).toBe('tok');
  });

  it('shows a taken-username message and keeps the user on the form after a 409', async () => {
    mock.onPost('/auth/register').reply(409, { message: 'That username is taken' });
    renderForm();

    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2!!');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/that username is taken/i);
    expect(useSession.getState().token).toBeNull();
  });

  it('does not submit an empty form', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(mock.history.post).toHaveLength(0);
  });

  it('links to the login screen', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('link', { name: /sign in/i }));
    expect(await screen.findByText('login screen')).toBeInTheDocument();
  });
});
