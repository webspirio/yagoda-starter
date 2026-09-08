import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import { PricesPage } from './PricesPage';
import type { GradeCatalogItem } from '@/entities/product-grade';
import type { CurrentPriceMap } from '../model/gradePrice';

const {
  gradeCatalogMock,
  currentPricesMock,
  setPriceMock,
  historyMock,
  meMock,
  pointScopeMock,
} = vi.hoisted(() => ({
  gradeCatalogMock: vi.fn(),
  currentPricesMock: vi.fn(),
  setPriceMock: vi.fn(),
  historyMock: vi.fn(),
  meMock: vi.fn(),
  pointScopeMock: vi.fn(),
}));

vi.mock('../api/gradePrices', () => ({
  useCurrentPricesQuery: (pointId: string | null) => currentPricesMock(pointId),
  useSetPriceMutation: () => ({ mutateAsync: setPriceMock }),
  usePriceHistoryQuery: (pointId: string | null, gradeId: string | null) =>
    historyMock(pointId, gradeId),
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

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
  usePointScope: () => pointScopeMock(),
}));

const OWNER = {
  id: 'u1',
  username: 'owner',
  display_name: 'Petro',
  role: 'network_owner',
  collection_point_id: null,
};
const OPERATOR = {
  id: 'u2',
  username: 'operator',
  display_name: 'Olha',
  role: 'point_operator',
  collection_point_id: 'p1',
};

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
  historyMock.mockReset().mockReturnValue({ data: undefined, isPending: false, isError: false });
  meMock.mockReset().mockReturnValue({ data: OWNER });
  pointScopeMock
    .mockReset()
    .mockReturnValue({ pointId: null, canPick: true, setPointId: vi.fn(), isLoading: false });
});

describe('PricesPage — the owner (unchanged behaviour)', () => {
  it('shows the pick-a-point prompt and no table before a point is chosen', async () => {
    const { container } = render(<PricesPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Day prices' })).toBeInTheDocument();
    expect(screen.getByText('No point selected')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('renders grade rows with the current price, and "—" for unpriced grades', async () => {
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    const { container } = render(<PricesPage />);

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
    // No lock, and the operator banner never renders for the owner.
    expect(screen.queryByRole('img', { name: 'view only' })).toBeNull();
    expect(screen.queryByText(/owner sets the day's price/i)).toBeNull();
    // The table sits in the card frame, like every table in the mock.
    expect(container.querySelector('[data-slot="data-table-frame"] table')).not.toBeNull();
    await expectNoAxeViolations(container);
  });

  it('opens the dialog and sets a price with the point + grade + money payload', async () => {
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    render(<PricesPage />);

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
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    render(<PricesPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Set price' }));
    expect(await screen.findByLabelText('Base price, ₴/kg')).toHaveValue('');
  });

  it('offers a History button only for the priced grade, and opens it', async () => {
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    render(<PricesPage />);

    const historyButtons = screen.getAllByRole('button', { name: 'History' });
    expect(historyButtons).toHaveLength(1);

    await userEvent.click(historyButtons[0]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Raspberry · Grade 1 · history')).toBeInTheDocument();
  });
});

describe('PricesPage — the operator (read-only)', () => {
  beforeEach(() => {
    meMock.mockReturnValue({ data: OPERATOR });
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: false,
      setPointId: vi.fn(),
      isLoading: false,
    });
  });

  it('shows a lock and the read-only banner instead of Change/Set, and hides the point picker', async () => {
    const { container } = render(<PricesPage />);

    expect(await screen.findByRole('table')).toBeInTheDocument();
    // No point picker — the operator is pinned to their own point.
    expect(screen.queryByLabelText('Select a point')).toBeNull();
    // The one-line banner explaining the lock.
    expect(
      screen.getByText(
        "The owner sets the day's price — this view only shows it. Every change leaves a trace: who, when and why.",
      ),
    ).toBeInTheDocument();
    // No Change/Set buttons anywhere — a lock icon with an accessible name instead.
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set price' })).toBeNull();
    expect(screen.getAllByRole('img', { name: 'view only' })).toHaveLength(2);
    // History is still offered for the priced grade.
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
