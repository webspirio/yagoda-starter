import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks } from '@/entities/user';

// Attached ONCE at module scope — see ProfilePage.test.tsx.
attachAuthInterceptors(httpClient, sessionAuthHooks);

import { GradesTab } from './GradesTab';

let mock: MockAdapter;

const list = (data: unknown[], total = data.length) => ({ data, total, page: 1, limit: 100 });
const MALYNA = { id: 'p1', name: 'Малина', created_at: '2026-07-15T06:00:00.000Z' };
const GRADE = {
  id: 'g1',
  product_id: 'p1',
  name: '1 сорт',
  is_active: true,
  created_at: '2026-07-15T06:00:00.000Z',
};

// GradesTab keeps its product filter in the query string, so it needs a router.
const renderTab = (initialEntry = '/catalog') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/catalog', element: <GradesTab /> }], {
    initialEntries: [initialEntry],
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

describe('GradesTab', () => {
  beforeEach(() => {
    mock = new MockAdapter(httpClient);
    mock.onGet('/products').reply(200, list([MALYNA]));
  });
  afterEach(() => mock.restore());

  // The grade response carries product_id and NOT the product name, so the
  // tab has to join the two lists itself.
  it('resolves each grade to its product name', async () => {
    mock.onGet('/product-grades').reply(200, list([GRADE]));
    renderTab();
    expect(await screen.findByText('1 сорт')).toBeInTheDocument();
    // Scoped to a table cell: the product filter's <select> also renders an
    // <option>Малина</option>, so a bare `getByText` is ambiguous here.
    expect(screen.getByRole('cell', { name: 'Малина' })).toBeInTheDocument();
  });

  it('filters by product through the query string', async () => {
    mock.onGet('/product-grades').reply(200, list([GRADE]));
    renderTab('/catalog?product_id=p1');
    await screen.findByText('1 сорт');
    const gradeRequests = mock.history.get.filter((r) => r.url === '/product-grades');
    expect(gradeRequests[0].params).toMatchObject({ product_id: 'p1' });
  });

  it('creates a grade against the selected product', async () => {
    mock.onGet('/product-grades').reply(200, list([]));
    mock.onPost('/product-grades').reply(201, GRADE);

    renderTab('/catalog?product_id=p1');
    fireEvent.click(await screen.findByRole('button', { name: 'Add grade' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '1 сорт' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ product_id: 'p1', name: '1 сорт' });
  });

  // Uniqueness is per product — "1 сорт" is legitimate for every berry — so
  // this conflict can only come from the server.
  it('puts a duplicate grade name under the name field', async () => {
    mock.onGet('/product-grades').reply(200, list([]));
    mock.onPost('/product-grades').reply(409, {
      message: 'That grade name is already used for this product',
      code: 'GRADE_NAME_TAKEN',
    });

    renderTab('/catalog?product_id=p1');
    fireEvent.click(await screen.findByRole('button', { name: 'Add grade' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '1 сорт' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('That name is already taken')).toBeInTheDocument();
  });

  // Deactivating the last active grade is how a PRODUCT is retired, so it must
  // never be blocked or warned about.
  it('deactivates a grade without sending product_id', async () => {
    mock.onGet('/product-grades').reply(200, list([GRADE]));
    mock.onPatch('/product-grades/g1').reply(200, { ...GRADE, is_active: false });

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit 1 сорт' }));
    fireEvent.click(screen.getByLabelText('Active'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mock.history.patch).toHaveLength(1));
    const body = JSON.parse(mock.history.patch[0].data);
    expect(body).toEqual({ name: '1 сорт', is_active: false });
    expect(body).not.toHaveProperty('product_id');
  });
});
