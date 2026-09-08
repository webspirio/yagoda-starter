import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

const product: Product = { id: 'pr1', name: 'Raspberry', created_at: '2026-08-01' };
const grade: ProductGrade = {
  id: 'g1',
  product_id: 'pr1',
  name: 'Grade 1',
  is_active: true,
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
  productsQueryMock.mockReset().mockReturnValue(loaded([product]));
  createProductMock.mockReset().mockResolvedValue(product);
  updateProductMock.mockReset().mockResolvedValue(product);
  gradesQueryMock.mockReset().mockReturnValue(loaded([grade]));
  createGradeMock.mockReset().mockResolvedValue(grade);
  updateGradeMock.mockReset().mockResolvedValue(grade);
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

describe('CatalogPage', () => {
  it('renders the products tab with rows and the New action by default', async () => {
    const { container } = renderPage();
    expect(screen.getByRole('tab', { name: 'Products', selected: true })).toBeInTheDocument();
    expect(screen.getByText('Raspberry')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New product' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('shows tare rows after switching to the Tare types tab', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Tare types' }));
    expect(await screen.findByText('Green crate')).toBeInTheDocument();
    expect(screen.getByText('1.20')).toBeInTheDocument();
    expect(screen.getByText('120.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New tare type' })).toBeInTheDocument();
  });

  it('creates a product through the New dialog with the mapped payload', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New product' }));
    // Dialog title is distinct from the "New product" button, so the field is
    // the unambiguous signal the dialog is open.
    await userEvent.type(screen.getByLabelText('Name'), 'Blueberry');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createProductMock).toHaveBeenCalledTimes(1));
    expect(createProductMock).toHaveBeenCalledWith({ name: 'Blueberry' });
  });
});
