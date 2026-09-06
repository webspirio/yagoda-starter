import { render, screen } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks } from '@/entities/user';

// Attached ONCE at module scope — see ProfilePage.test.tsx.
attachAuthInterceptors(httpClient, sessionAuthHooks);

import { CatalogPage } from './CatalogPage';

let mock: MockAdapter;
const empty = { data: [], total: 0, page: 1, limit: 100 };

const renderPage = (initialEntry = '/catalog') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/catalog', element: <CatalogPage /> }], {
    initialEntries: [initialEntry],
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

describe('CatalogPage', () => {
  beforeEach(() => {
    mock = new MockAdapter(httpClient);
    mock.onGet('/products').reply(200, empty);
    mock.onGet('/product-grades').reply(200, empty);
    mock.onGet('/tare-types').reply(200, empty);
  });
  afterEach(() => mock.restore());

  it('shows all three tabs', async () => {
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Products' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Grades' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tare types' })).toBeInTheDocument();
  });

  it('opens on products by default', async () => {
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Products', selected: true })).toBeInTheDocument();
  });

  // The tab is in the URL so it survives a reload and can be linked.
  it('opens the tab named in the query string', async () => {
    renderPage('/catalog?tab=tareTypes');
    expect(
      await screen.findByRole('tab', { name: 'Tare types', selected: true }),
    ).toBeInTheDocument();
  });

  // A hand-edited or stale URL must not render an empty shell.
  it('falls back to products when the query string names an unknown tab', async () => {
    renderPage('/catalog?tab=nonsense');
    expect(await screen.findByRole('tab', { name: 'Products', selected: true })).toBeInTheDocument();
  });
});
