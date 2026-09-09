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
    expect(screen.getByRole('heading', { level: 1, name: 'Collection points' })).toBeInTheDocument();
    expect(screen.getByText('Шипинки')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New point' })).toBeInTheDocument();
  });

  it('creates a point through the New dialog (empty targets → null)', async () => {
    queryMock.mockReturnValue(loaded([]));
    render(<PointsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'New point' }));
    expect(screen.getByText('New collection point')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Гаї');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith({
      name: 'Гаї',
      kind: 'reception',
      target_cash: null,
      target_crates: null,
    });
  });

  it('opens the edit dialog prefilled from a row', async () => {
    queryMock.mockReturnValue(loaded([point]));
    render(<PointsPage />);
    await userEvent.click(screen.getByText('Шипинки'));
    expect(screen.getByText('Edit collection point')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Шипинки');
  });
});
