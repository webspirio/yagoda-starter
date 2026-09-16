import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks, useSession } from '@/entities/user';
import { LoginForm } from './LoginForm';

// Attached once at module scope — see authApi.test.ts for why attaching this
// inside beforeEach would stack interceptors across the tests in this file
// and corrupt the ApiError status on every test after the first.
attachAuthInterceptors(httpClient, sessionAuthHooks);

let mock: MockAdapter;

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginForm /> },
      { path: '/', element: <p>dashboard</p> },
    ],
    { initialEntries: ['/login'] },
  );
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('LoginForm', () => {
  beforeEach(() => {
    useSession.setState({ token: null });
    mock = new MockAdapter(httpClient);
  });
  afterEach(() => mock.restore());

  it('stores the token and navigates on success', async () => {
    mock.onPost('/auth/login').reply(200, { access_token: 'tok' });
    renderForm();

    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2!!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('dashboard')).toBeInTheDocument();
    expect(useSession.getState().token).toBe('tok');
  });

  it('shows the error message and keeps the user on the form after a 401', async () => {
    mock.onPost('/auth/login').reply(401, { message: 'Invalid username or password' });
    renderForm();

    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText('Password'), 'wrongpass');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid username or password/i);
    expect(useSession.getState().token).toBeNull();
  });

  it('branches on the machine-readable code rather than the message', async () => {
    mock.onPost('/auth/login').reply(401, { message: 'nope', code: 'INVALID_CREDENTIALS' });
    renderForm();

    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText('Password'), 'wrongpass');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid username or password/i);
  });

  it('does not submit an empty form', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(mock.history.post).toHaveLength(0);
  });

  // Issue #11's «око» on the sign-in screen: someone typing a password an
  // owner read out to them must be able to check it before submitting.
  it('unmasks the typed password on the eye, and re-masks it', async () => {
    renderForm();
    const password = screen.getByLabelText('Password');
    await userEvent.type(password, 'hunter2!!');

    expect(password).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('hunter2!!');

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });
});
