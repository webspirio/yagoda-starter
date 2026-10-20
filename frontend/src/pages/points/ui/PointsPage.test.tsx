import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PointsPage } from './PointsPage';
import type { CollectionPoint } from '../model/collectionPoint';

const { queryMock, createMock, updateMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('../api/collectionPoints', () => ({
  useCollectionPointsQuery: () => queryMock(),
  useCreateCollectionPointMutation: () => ({ mutateAsync: createMock }),
  useUpdateCollectionPointMutation: () => ({ mutateAsync: updateMock }),
}));

const point: CollectionPoint = {
  id: 'p1',
  name: 'Шипинки',
  code: 'SHP',
  number: 3,
  kind: 'reception',
  target_cash: '15000.00',
  target_crates: 800,
  is_active: true,
  created_at: '2026-08-01',
};

const loaded = (rows: CollectionPoint[]) => ({
  data: { data: rows, total: rows.length, page: 1, limit: 20 },
  isPending: false,
  isError: false,
});

beforeEach(() => {
  queryMock.mockReset();
  createMock.mockReset().mockResolvedValue(point);
  updateMock.mockReset().mockResolvedValue(point);
});

describe('PointsPage', () => {
  it('shows a spinner while loading', () => {
    queryMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<PointsPage />);
    expect(screen.queryByText('Шипинки')).toBeNull();
  });

  it('renders points and the New action when loaded', () => {
    queryMock.mockReturnValue(loaded([point]));
    render(<PointsPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Collection points' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Шипинки')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New point' })).toBeInTheDocument();
  });

  // #250: the same number the receipt header prints as «Point No. 3» — and a
  // deactivated point keeps it, because its old receipts still print it.
  it('shows each point\'s number, deactivated ones included', () => {
    queryMock.mockReturnValue(loaded([{ ...point, is_active: false }]));
    render(<PointsPage />);
    expect(screen.getByRole('columnheader', { name: 'No.' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '3' })).toBeInTheDocument();
  });

  it('creates a point through the New dialog (empty targets → null)', async () => {
    queryMock.mockReturnValue(loaded([]));
    render(<PointsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'New point' }));
    expect(screen.getByText('New collection point')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Гаї');
    await userEvent.type(screen.getByLabelText('Point code'), 'hai');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith({
      name: 'Гаї',
      code: 'HAI',
      kind: 'reception',
      target_cash: null,
      target_crates: null,
    });
  });

  it('never holds a space in the cash target: «15 000,50» submits 15000.50 (#72)', async () => {
    queryMock.mockReturnValue(loaded([]));
    render(<PointsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'New point' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Гаї');
    await userEvent.type(screen.getByLabelText('Point code'), 'hai');
    const cash = screen.getByLabelText('Cash target, ₴');
    await userEvent.type(cash, '15 000,50');
    expect(cash).toHaveValue('15000.50');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0].target_cash).toBe('15000.50');
  });

  it('refuses a half-typed cash target «12.» with the shared message (#72)', async () => {
    queryMock.mockReturnValue(loaded([]));
    render(<PointsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'New point' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Гаї');
    await userEvent.type(screen.getByLabelText('Point code'), 'hai');
    await userEvent.type(screen.getByLabelText('Cash target, ₴'), '12.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a number, e.g. 12000 or 980.40')).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('opens the edit dialog prefilled from a row', async () => {
    queryMock.mockReturnValue(loaded([point]));
    render(<PointsPage />);
    await userEvent.click(screen.getByText('Шипинки'));
    expect(screen.getByText('Edit collection point')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Шипинки');
  });

  // #250: the number is assigned by the database — neither dialog offers a field for it.
  it.each([
    ['create', 'New point'],
    ['edit', 'Шипинки'],
  ])('offers no number field in the %s dialog', async (_, opener) => {
    queryMock.mockReturnValue(loaded([point]));
    render(<PointsPage />);
    await userEvent.click(screen.getByText(opener));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^(No\.|Number)$/)).toBeNull();
  });
});
