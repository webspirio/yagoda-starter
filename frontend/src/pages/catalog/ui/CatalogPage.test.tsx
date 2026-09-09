import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expectNoAxeViolations } from '../../../test-axe';
import { CatalogPage } from './CatalogPage';
import type { Product } from '../model/product';
import type { ProductGrade } from '../model/productGrade';
import type { TareType } from '../model/tareType';

const {
  productsQueryMock,
  createProductMock,
  updateProductMock,
  gradesQueryMock,
  createGradeMock,
  updateGradeMock,
  tareQueryMock,
  createTareMock,
  updateTareMock,
} = vi.hoisted(() => ({
  productsQueryMock: vi.fn(),
  createProductMock: vi.fn(),
  updateProductMock: vi.fn(),
  gradesQueryMock: vi.fn(),
  createGradeMock: vi.fn(),
  updateGradeMock: vi.fn(),
  tareQueryMock: vi.fn(),
  createTareMock: vi.fn(),
  updateTareMock: vi.fn(),
}));

vi.mock('../api/products', () => ({
  useProductsQuery: () => productsQueryMock(),
  useCreateProductMutation: () => ({ mutateAsync: createProductMock }),
  useUpdateProductMutation: () => ({ mutateAsync: updateProductMock }),
}));

vi.mock('../api/productGrades', () => ({
  useProductGradesQuery: (productId?: string) => gradesQueryMock(productId),
  useCreateProductGradeMutation: () => ({ mutateAsync: createGradeMock }),
  useUpdateProductGradeMutation: () => ({ mutateAsync: updateGradeMock }),
}));

vi.mock('../api/tareTypes', () => ({
  useTareTypesQuery: () => tareQueryMock(),
  useCreateTareTypeMutation: () => ({ mutateAsync: createTareMock }),
  useUpdateTareTypeMutation: () => ({ mutateAsync: updateTareMock }),
}));

const raspberry: Product = { id: 'pr1', name: 'Raspberry', created_at: '2026-08-01' };
const cornel: Product = { id: 'pr2', name: 'Cornel', created_at: '2026-08-01' };
const grade1: ProductGrade = {
  id: 'g1',
  product_id: 'pr1',
  name: 'Grade 1',
  is_active: true,
  created_at: '2026-08-01',
};
const retired: ProductGrade = {
  id: 'g2',
  product_id: 'pr1',
  name: 'Substandard',
  is_active: false,
  created_at: '2026-08-01',
};
const tare: TareType = {
  id: 'tt1',
  name: 'Green crate',
  weight_kg: '1.20',
  deposit_price: '120.00',
  is_crate: true,
  is_active: true,
  created_at: '2026-08-01',
};

const loaded = <T,>(rows: T[]) => ({
  data: { data: rows, total: rows.length, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

beforeEach(() => {
  productsQueryMock.mockReset().mockReturnValue(loaded([raspberry, cornel]));
  createProductMock.mockReset().mockResolvedValue(raspberry);
  updateProductMock.mockReset().mockResolvedValue(raspberry);
  gradesQueryMock.mockReset().mockReturnValue(loaded([grade1, retired]));
  createGradeMock.mockReset().mockResolvedValue(grade1);
  updateGradeMock.mockReset().mockResolvedValue(grade1);
  tareQueryMock.mockReset().mockReturnValue(loaded([tare]));
  createTareMock.mockReset().mockResolvedValue(tare);
  updateTareMock.mockReset().mockResolvedValue(tare);
});

const renderPage = (entry = '/catalog') => {
  const router = createMemoryRouter([{ path: '/catalog', element: <CatalogPage /> }], {
    initialEntries: [entry],
  });
  return render(<RouterProvider router={router} />);
};

const productList = () => screen.getByRole('list', { name: 'Products' });
const detail = () => screen.getByRole('region', { name: /Cornel|Raspberry/ });

describe('CatalogPage', () => {
  it('opens on the master–detail tab with the first product selected and its grades in the pane', async () => {
    const { container } = renderPage();
    expect(
      screen.getByRole('tab', { name: 'Products & grades', selected: true }),
    ).toBeInTheDocument();

    // The list is alphabetical with a grade count per product; Cornel comes first.
    const list = productList();
    const items = within(list).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual(['Cornel0', 'Raspberry2']);
    expect(items[0]).toHaveAttribute('aria-current', 'true');

    // Cornel has no grades: the pane says so instead of showing an empty table.
    expect(within(detail()).getByRole('heading', { name: 'Cornel' })).toBeInTheDocument();
    expect(within(detail()).getByText('No grades yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();

    // The grades query is unfiltered — grouping is done client-side.
    expect(gradesQueryMock).toHaveBeenCalledWith(undefined);
    await expectNoAxeViolations(container);
  });

  it('switches the pane to the clicked product and lists its grades with status', async () => {
    renderPage();
    await userEvent.click(within(productList()).getByRole('button', { name: /Raspberry/ }));

    const pane = detail();
    expect(within(pane).getByRole('heading', { name: 'Raspberry' })).toBeInTheDocument();
    expect(within(pane).getByText('2 grades · 1 active')).toBeInTheDocument();
    expect(within(pane).getByText('Grade 1')).toBeInTheDocument();
    const retiredRow = within(pane).getByText('Substandard').closest('tr');
    expect(retiredRow).toHaveTextContent('Inactive');
  });

  it('selects the product named in the URL', () => {
    renderPage('/catalog?product=pr1');
    expect(within(detail()).getByRole('heading', { name: 'Raspberry' })).toBeInTheDocument();
  });

  it('filters the product list by the search box without losing the selection', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText('Search products'), 'rasp');
    expect(within(productList()).queryByRole('button', { name: /Cornel/ })).toBeNull();
    expect(within(productList()).getByRole('button', { name: /Raspberry/ })).toBeInTheDocument();
    expect(within(detail()).getByRole('heading', { name: 'Cornel' })).toBeInTheDocument();
  });

  it('shows the tare table after switching to the Tare types tab', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Tare types' }));
    expect(await screen.findByText('Green crate')).toBeInTheDocument();
    expect(screen.getByText('1.20')).toBeInTheDocument();
    expect(screen.getByText('120.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New tare type' })).toBeInTheDocument();
  });

  it('falls back to the first tab for a stale ?tab=grades link', () => {
    renderPage('/catalog?tab=grades');
    expect(
      screen.getByRole('tab', { name: 'Products & grades', selected: true }),
    ).toBeInTheDocument();
  });

  it('creates a product through the New dialog with the mapped payload', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New product' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Blueberry');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createProductMock).toHaveBeenCalledTimes(1));
    expect(createProductMock).toHaveBeenCalledWith({ name: 'Blueberry' });
  });

  it('adds a grade to the selected product with that product preselected', async () => {
    renderPage();
    await userEvent.click(within(detail()).getByRole('button', { name: 'New grade' }));
    expect(await screen.findByLabelText('Product')).toHaveValue('pr2');
    await userEvent.type(screen.getByLabelText('Name'), 'Standard');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createGradeMock).toHaveBeenCalledTimes(1));
    expect(createGradeMock).toHaveBeenCalledWith({ product_id: 'pr2', name: 'Standard' });
  });

  it('opens a grade row for editing with its current values', async () => {
    renderPage('/catalog?product=pr1');
    await userEvent.click(within(detail()).getByText('Grade 1'));
    expect(await screen.findByLabelText('Name')).toHaveValue('Grade 1');
  });
});
