import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expectNoAxeViolations } from '../../../test-axe';
import type { Shift } from '@/entities/shift';
import { DashboardPage } from './DashboardPage';

const { meMock, pointOptionsMock, networkTodayMock, balancesMock } = vi.hoisted(() => ({
  meMock: vi.fn(),
  pointOptionsMock: vi.fn(),
  networkTodayMock: vi.fn(),
  balancesMock: vi.fn(),
}));

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
}));

vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => pointOptionsMock(),
}));

vi.mock('@/entities/supplier', () => ({
  useSupplierBalancesQuery: (filter: unknown) => balancesMock(filter),
  supplierName: (s: { first_name: string; last_name: string }) => `${s.first_name} ${s.last_name}`,
}));

vi.mock('../api/useNetworkToday', () => ({
  useNetworkToday: (pointIds: string[]) => networkTodayMock(pointIds),
}));

const OWNER = {
  id: 'u2',
  username: 'owner',
  display_name: 'Petro',
  role: 'network_owner',
  collection_point_id: null,
};
const OPERATOR = {
  id: 'u1',
  username: 'operator',
  display_name: 'Olha',
  role: 'point_operator',
  collection_point_id: 'p1',
};

const POINTS = [
  { id: 'p1', name: 'Shypynky' },
  { id: 'p2', name: 'Haiove' },
];

const openShift: Shift = {
  id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  status: 'open',
  opened_by_user_id: 'u1',
  closed_by_user_id: null,
  closed_at: null,
  created_at: '2026-09-08T05:00:00Z',
  explanation: null,
};

const balanceRow = (over: Partial<{
  supplier_id: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  collection_point_id: string;
  debt: string;
}> = {}) => ({
  supplier_id: 'sup1',
  first_name: 'Ivan',
  last_name: 'Koval',
  is_active: true,
  collection_point_id: 'p1',
  debt: '10.00',
  ...over,
});

function renderDashboard() {
  const router = createMemoryRouter([{ path: '/', element: <DashboardPage /> }], {
    initialEntries: ['/'],
  });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-08T09:00:00') });
  meMock.mockReset().mockReturnValue({ data: OWNER, isPending: false });
  pointOptionsMock.mockReset().mockReturnValue({ data: POINTS, isPending: false, isError: false });
  networkTodayMock.mockReset().mockReturnValue({
    rows: [
      { pointId: 'p1', shift: openShift, receipts: 3, accrued: '128.00', paid: '40.00', truncated: false },
      { pointId: 'p2', shift: null, receipts: 0, accrued: '0.00', paid: '0.00', truncated: false },
    ],
    isPending: false,
    isError: false,
    anyTruncated: false,
  });
  balancesMock.mockReset().mockReturnValue({
    data: { data: [balanceRow(), balanceRow({ supplier_id: 'sup2', first_name: 'Olena', last_name: 'Bila', collection_point_id: 'p2', debt: '5.00' })], total: 2, page: 1, limit: 100 },
    isPending: false,
    isError: false,
  });
});

afterEach(() => vi.useRealTimers());

describe('DashboardPage — the owner', () => {
  it('titles the page and shows the network tiles for today', async () => {
    const { container } = renderDashboard();

    expect(screen.getByRole('heading', { level: 1, name: 'Summary' })).toBeInTheDocument();

    const tile = (label: string) => screen.getByText(label).closest('[data-slot="stat-tile"]');
    expect(tile('Points open')).toHaveTextContent('1 / 2');
    expect(tile('Receipts today')).toHaveTextContent('3');
    expect(tile('Accrued')).toHaveTextContent('128.00 ₴');
    expect(tile('Paid')).toHaveTextContent('40.00 ₴');
    expect(tile('Network balances')).toHaveTextContent('15.00 ₴');

    await expectNoAxeViolations(container);
  });

  it('shows a row per active point, with the no-shift point flagged unopened', () => {
    renderDashboard();

    expect(screen.getByText('Shypynky')).toBeInTheDocument();
    expect(screen.getByText('Haiove')).toBeInTheDocument();
    expect(screen.getByText('Shift not opened yet')).toBeInTheDocument();

    const p1Row = screen.getByText('Shypynky').closest('[data-slot="card"]') as HTMLElement;
    expect(within(p1Row).getByRole('link', { name: 'Cash for the day' })).toHaveAttribute(
      'href',
      '/day?point=p1',
    );
    expect(within(p1Row).getByRole('link', { name: 'Intake' })).toHaveAttribute(
      'href',
      '/reception?point=p1',
    );
  });

  it('lists the biggest balances, linking each to that supplier’s point', () => {
    renderDashboard();

    const links = screen.getAllByRole('link', { name: /Ivan Koval|Olena Bila/ });
    expect(links[0]).toHaveAttribute('href', '/debts?point=p1');
    expect(links[1]).toHaveAttribute('href', '/debts?point=p2');
  });

  it('hints that balances are partial only once the server has more than 100', () => {
    balancesMock.mockReturnValue({
      data: { data: [balanceRow()], total: 150, page: 1, limit: 100 },
      isPending: false,
      isError: false,
    });

    renderDashboard();

    expect(screen.getByText('first 100')).toBeInTheDocument();
  });

  it('says nothing about truncation when the balances page is not the server’s only one', () => {
    renderDashboard();
    expect(screen.queryByText('first 100')).toBeNull();
  });

  it('hints at the 100-row cap on the receipts/accrued/paid tiles, and on the affected point row, once any point read hit it', () => {
    networkTodayMock.mockReturnValue({
      rows: [
        { pointId: 'p1', shift: openShift, receipts: 100, accrued: '999.00', paid: '40.00', truncated: true },
        { pointId: 'p2', shift: null, receipts: 0, accrued: '0.00', paid: '0.00', truncated: false },
      ],
      isPending: false,
      isError: false,
      anyTruncated: true,
    });

    renderDashboard();

    const tile = (label: string) => screen.getByText(label).closest('[data-slot="stat-tile"]');
    expect(tile('Receipts today')).toHaveTextContent('first 100 per point');
    expect(tile('Accrued')).toHaveTextContent('first 100 per point');
    expect(tile('Paid')).toHaveTextContent('first 100 per point');

    const p1Row = screen.getByText('Shypynky').closest('[data-slot="card"]') as HTMLElement;
    expect(within(p1Row).getByText('first 100 per point')).toBeInTheDocument();
    const p2Row = screen.getByText('Haiove').closest('[data-slot="card"]') as HTMLElement;
    expect(within(p2Row).queryByText('first 100 per point')).toBeNull();
  });

  it('flags a point whose shift awaits an explanation', () => {
    networkTodayMock.mockReturnValue({
      rows: [
        {
          pointId: 'p1',
          shift: { ...openShift, status: 'awaiting_explanation' },
          receipts: 3,
          accrued: '128.00',
          paid: '40.00',
          truncated: false,
        },
        { pointId: 'p2', shift: null, receipts: 0, accrued: '0.00', paid: '0.00', truncated: false },
      ],
      isPending: false,
      isError: false,
      anyTruncated: false,
    });

    renderDashboard();

    expect(screen.getByText('Needs an explanation')).toBeInTheDocument();
  });
});

describe('DashboardPage — the operator', () => {
  beforeEach(() => {
    meMock.mockReturnValue({ data: OPERATOR, isPending: false });
    networkTodayMock.mockReturnValue({
      rows: [
        { pointId: 'p1', shift: openShift, receipts: 1, accrued: '10.00', paid: '0.00', truncated: false },
      ],
      isPending: false,
      isError: false,
      anyTruncated: false,
    });
  });

  it('shows only their own point and never asks for network balances', async () => {
    const { container } = renderDashboard();

    expect(screen.getByText('Shypynky')).toBeInTheDocument();
    expect(screen.queryByText('Haiove')).toBeNull();
    expect(screen.queryByText('Points open')).toBeNull();
    expect(screen.queryByText('Network balances')).toBeNull();

    expect(balancesMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    expect(networkTodayMock).toHaveBeenCalledWith(['p1']);

    await expectNoAxeViolations(container);
  });

  it('offers the three shortcuts', () => {
    renderDashboard();

    expect(screen.getByRole('link', { name: 'Intake' })).toHaveAttribute('href', '/reception');
    expect(screen.getByRole('link', { name: 'Cash for the day' })).toHaveAttribute('href', '/day');
    expect(screen.getByRole('link', { name: 'Balances' })).toHaveAttribute('href', '/debts');
  });
});

describe('DashboardPage — a failed read', () => {
  it('shows the error state', () => {
    networkTodayMock.mockReturnValue({ rows: [], isPending: false, isError: true });

    renderDashboard();

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByText('Points open')).toBeNull();
  });
});
