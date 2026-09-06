import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks } from '@/entities/user';

// Attached ONCE at module scope — see ProfilePage.test.tsx.
attachAuthInterceptors(httpClient, sessionAuthHooks);

import { TareTypesTab } from './TareTypesTab';

let mock: MockAdapter;

const list = (data: unknown[], total = data.length) => ({ data, total, page: 1, limit: 100 });
const CRATE = {
  id: 't1',
  name: 'Ящик',
  weight_kg: '1.20',
  deposit_price: '120.00',
  is_crate: true,
  is_active: true,
  created_at: '2026-07-15T06:00:00.000Z',
};

const renderTab = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TareTypesTab />
    </QueryClientProvider>,
  );
};

describe('TareTypesTab', () => {
  beforeEach(() => {
    mock = new MockAdapter(httpClient);
  });
  afterEach(() => mock.restore());

  it('renders both numbers exactly as the server sent them', async () => {
    mock.onGet('/tare-types').reply(200, list([CRATE]));
    renderTab();
    // '1.20', not '1.2': the trailing zero survives only if nothing coerced it.
    expect(await screen.findByText('1.20')).toBeInTheDocument();
    expect(screen.getByText('120.00')).toBeInTheDocument();
  });

  /**
   * THE MOST IMPORTANT TEST IN THIS SLICE.
   *
   * `weight_kg` and `deposit_price` must reach the wire as the exact strings
   * typed. A regression to <input type="number"> — or any coercion — turns
   * '1.20' into 1.2 and '120.00' into 120, and every other test in this file
   * would still pass. This one would not.
   */
  it('sends the numbers as strings, unmodified', async () => {
    mock.onGet('/tare-types').reply(200, list([]));
    mock.onPost('/tare-types').reply(201, CRATE);

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add tare type' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ящик' } });
    fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '1.20' } });
    fireEvent.change(screen.getByLabelText('Deposit price'), { target: { value: '120.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.weight_kg).toBe('1.20');
    expect(body.deposit_price).toBe('120.00');
    expect(typeof body.weight_kg).toBe('string');
    expect(typeof body.deposit_price).toBe('string');
    // is_active is not part of the create DTO.
    expect(body).not.toHaveProperty('is_active');
  });

  it('never renders a number input for either money field', async () => {
    mock.onGet('/tare-types').reply(200, list([]));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add tare type' }));
    expect(screen.getByLabelText('Weight (kg)')).not.toHaveAttribute('type', 'number');
    expect(screen.getByLabelText('Deposit price')).not.toHaveAttribute('type', 'number');
  });

  it('rejects a malformed decimal before sending anything', async () => {
    mock.onGet('/tare-types').reply(200, list([]));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add tare type' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ящик' } });
    fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '1.234' } });
    fireEvent.change(screen.getByLabelText('Deposit price'), { target: { value: '120.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Use a number with up to 2 decimals, e.g. 1.20'),
    ).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  // A non-crate carrying a deposit price is legal — the backend deliberately
  // has no rule tying the two — so the form must not invent one.
  it('allows a non-crate to carry a deposit price', async () => {
    mock.onGet('/tare-types').reply(200, list([]));
    mock.onPost('/tare-types').reply(201, { ...CRATE, is_crate: false });

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add tare type' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Відро' } });
    fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '0.30' } });
    fireEvent.change(screen.getByLabelText('Deposit price'), { target: { value: '50.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data)).toMatchObject({
      is_crate: false,
      deposit_price: '50.00',
    });
  });

  it('puts a duplicate name under the name field', async () => {
    mock.onGet('/tare-types').reply(200, list([]));
    mock.onPost('/tare-types').reply(409, {
      message: 'That name is taken',
      code: 'TARE_TYPE_NAME_TAKEN',
    });

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add tare type' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'ящик' } });
    fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '1.20' } });
    fireEvent.change(screen.getByLabelText('Deposit price'), { target: { value: '120.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('That name is already taken')).toBeInTheDocument();
  });
});
