import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import { PricesPage } from './PricesPage';
import type { GradeCatalogItem } from '@/entities/product-grade';
import type { CurrentPriceMap } from '../model/gradePrice';

const { gradeCatalogMock, currentPricesMock, setPriceMock } = vi.hoisted(() => ({
  gradeCatalogMock: vi.fn(),
  currentPricesMock: vi.fn(),
  setPriceMock: vi.fn(),
}));

vi.mock('../api/gradePrices', () => ({
  useCurrentPricesQuery: (pointId: string | null) => currentPricesMock(pointId),
  useSetPriceMutation: () => ({ mutateAsync: setPriceMock }),
}));

vi.mock('@/entities/product-grade', () => ({
  useGradeCatalogQuery: () => gradeCatalogMock(),
}));

vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => ({
    data: [
      { id: 'p1', name: 'Shypynky' },
      { id: 'p2', name: 'Haiove' },
    ],
    isPending: false,
    isError: false,
  }),
}));

const g1: GradeCatalogItem = {
  id: 'g1',
  name: 'Grade 1',
  productId: 'pr1',
  productName: 'Raspberry',
};
const g2: GradeCatalogItem = {
  id: 'g2',
  name: 'Grade 2',
  productId: 'pr1',
  productName: 'Raspberry',
};

// Only g1 is priced; g2 must render "—" across all three money columns.
const priceMap: CurrentPriceMap = {
  g1: { base_price: '50.00', max_markup: '5.00', max_discount: '3.00' },
};

beforeEach(() => {
  gradeCatalogMock
    .mockReset()
    .mockReturnValue({ data: [g1, g2], isPending: false, isError: false });
  currentPricesMock
    .mockReset()
    .mockReturnValue({ data: priceMap, isPending: false, isError: false });
  setPriceMock.mockReset().mockResolvedValue({ id: 'gp1' });
});

describe('PricesPage', () => {
  it('shows the pick-a-point prompt and no table before a point is chosen', async () => {
    const { container } = render(<PricesPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Day prices' })).toBeInTheDocument();
    expect(screen.getByText('No point selected')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('renders grade rows with the current price, and "—" for unpriced grades', async () => {
    const { container } = render(<PricesPage />);
    await userEvent.selectOptions(screen.getByLabelText('Select a point'), 'p1');

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Raspberry · Grade 1')).toBeInTheDocument();
    expect(screen.getByText('Raspberry · Grade 2')).toBeInTheDocument();
    // g1's price is shown…
    expect(screen.getByText('50.00')).toBeInTheDocument();
    expect(screen.getByText('5.00')).toBeInTheDocument();
    expect(screen.getByText('3.00')).toBeInTheDocument();
    // …and g2 is unpriced across all three money columns.
    expect(screen.getAllByText('—')).toHaveLength(3);
    // The verb tells the two apart: a priced grade is changed, an unpriced one set.
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set price' })).toBeInTheDocument();
    // The table sits in the card frame, like every table in the mock.
    expect(container.querySelector('[data-slot="data-table-frame"] table')).not.toBeNull();
    await expectNoAxeViolations(container);
  });

  it('opens the dialog and sets a price with the point + grade + money payload', async () => {
    render(<PricesPage />);
    await userEvent.selectOptions(screen.getByLabelText('Select a point'), 'p1');

    await userEvent.click(screen.getByRole('button', { name: 'Change' }));

    // Dialog is open, names the point, and is prefilled from g1's current price.
    expect(await screen.findByLabelText('Base price, ₴/kg')).toHaveValue('50.00');
    expect(screen.getByText(/^Shypynky · /)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setPriceMock).toHaveBeenCalledTimes(1));
    expect(setPriceMock).toHaveBeenCalledWith({
      collection_point_id: 'p1',
      product_grade_id: 'g1',
      base_price: '50.00',
      max_markup: '5.00',
      max_discount: '3.00',
    });
  });

  it('opens an empty dialog for an unpriced grade', async () => {
    render(<PricesPage />);
    await userEvent.selectOptions(screen.getByLabelText('Select a point'), 'p1');
    await userEvent.click(screen.getByRole('button', { name: 'Set price' }));
    expect(await screen.findByLabelText('Base price, ₴/kg')).toHaveValue('');
  });
});
