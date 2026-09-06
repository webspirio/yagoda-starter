import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks } from '@/entities/user';

// Attached ONCE at module scope — see ProfilePage.test.tsx for why beforeEach
// would collapse every error status to 0.
attachAuthInterceptors(httpClient, sessionAuthHooks);

import { ProductsTab } from './ProductsTab';

let mock: MockAdapter;

const list = (data: unknown[], total = data.length) => ({ data, total, page: 1, limit: 100 });
const MALYNA = { id: 'p1', name: 'Малина', created_at: '2026-07-15T06:00:00.000Z' };

const renderTab = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProductsTab />
    </QueryClientProvider>,
  );
};

describe('ProductsTab', () => {
  beforeEach(() => {
    mock = new MockAdapter(httpClient);
  });
  afterEach(() => mock.restore());

  it('lists products', async () => {
    mock.onGet('/products').reply(200, list([MALYNA]));
    renderTab();
    expect(await screen.findByText('Малина')).toBeInTheDocument();
  });

  it('shows an empty state rather than a bare table', async () => {
    mock.onGet('/products').reply(200, list([]));
    renderTab();
    expect(await screen.findByText('No products yet.')).toBeInTheDocument();
  });

  // A failed GET must not be indistinguishable from an empty catalog: without
  // an isError branch, data falls back to [] and the owner sees "No products
  // yet." with an Add button, with no hint anything went wrong.
  it('shows an error instead of the empty state when the list fails to load', async () => {
    mock.onGet('/products').reply(500, { message: 'boom' });
    renderTab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByText('No products yet.')).not.toBeInTheDocument();
  });

  // The API caps these lists at 100. If the business ever exceeds that, a
  // silently short list means an owner cannot find a berry that exists.
  it('warns when the server returned fewer rows than it counted', async () => {
    mock.onGet('/products').reply(200, list([MALYNA], 140));
    renderTab();
    expect(await screen.findByRole('status')).toHaveTextContent('Showing 1 of 140');
  });

  it('creates a product and refetches the list', async () => {
    mock.onGet('/products').replyOnce(200, list([]));
    mock.onPost('/products').reply(201, MALYNA);
    mock.onGet('/products').reply(200, list([MALYNA]));

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add product' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Малина' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ name: 'Малина' });
    expect(await screen.findByText('Малина')).toBeInTheDocument();
  });

  // The conflict cannot be detected client-side: it is a lower(name) index
  // lookup. It must land under the input, not in a banner.
  it('puts a duplicate-name conflict under the name field', async () => {
    mock.onGet('/products').reply(200, list([]));
    mock.onPost('/products').reply(409, { message: 'That name is taken', code: 'PRODUCT_NAME_TAKEN' });

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add product' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'малина' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('That name is already taken')).toBeInTheDocument();
    // Still open, so the value can be corrected in place.
    expect(screen.getByLabelText('Name')).toHaveValue('малина');
  });

  it('edits an existing product through the same dialog', async () => {
    mock.onGet('/products').reply(200, list([MALYNA]));
    mock.onPatch('/products/p1').reply(200, { ...MALYNA, name: 'Полуниця' });

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Малина' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Полуниця' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mock.history.patch).toHaveLength(1));
    expect(JSON.parse(mock.history.patch[0].data)).toEqual({ name: 'Полуниця' });
  });

  // Reopening for CREATE right after an EDIT must not carry the edited row's
  // value forward — the two sessions must not bleed into each other.
  it('does not carry an edited row into a fresh create dialog', async () => {
    mock.onGet('/products').reply(200, list([MALYNA]));

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Малина' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Малина');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Add product' }));
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  // A server error from a previous attempt must not survive into the next
  // time the dialog is opened.
  it('clears a previous conflict error when the dialog reopens', async () => {
    mock.onGet('/products').reply(200, list([]));
    mock.onPost('/products').reply(409, { message: 'That name is taken', code: 'PRODUCT_NAME_TAKEN' });

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add product' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'малина' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('That name is already taken')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add product' }));
    expect(screen.queryByText('That name is already taken')).not.toBeInTheDocument();
  });
});
