import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import { CratesPage } from './CratesPage';
import type { CrateBalanceRow, CrateStanding } from '@/entities/crate';

const { standingMock, balancesMock, meMock, scopeMock, pointsMock, issueDialogMock, returnDialogMock } =
  vi.hoisted(() => ({
    standingMock: vi.fn(),
    balancesMock: vi.fn(),
    meMock: vi.fn(),
    scopeMock: vi.fn(),
    pointsMock: vi.fn(),
    issueDialogMock: vi.fn(),
    returnDialogMock: vi.fn(),
  }));

vi.mock('@/entities/crate', () => ({
  useCrateBalancesQuery: (args: unknown) => balancesMock(args),
  useCrateStandingQuery: (args: unknown) => standingMock(args),
}));

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
  usePointScope: () => scopeMock(),
}));

vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => pointsMock(),
}));

vi.mock('./CrateStandingBar', () => ({
  CrateStandingBar: ({ standing }: { standing: { in_field: number } }) => (
    <div data-testid="bar">{standing.in_field}</div>
  ),
}));
vi.mock('./InFieldTable', () => ({
  InFieldTable: (p: { holders: number; truncated: boolean }) => (
    <div data-testid="table" data-holders={p.holders} data-truncated={String(p.truncated)} />
  ),
}));

vi.mock('@/features/issue-crates', () => ({
  IssueCratesDialog: (props: Record<string, unknown>) => {
    issueDialogMock(props);
    return props.open ? <div data-testid="issue-dialog-mock" /> : null;
  },
}));

vi.mock('@/features/return-crates', () => ({
  ReturnCratesDialog: (props: Record<string, unknown>) => {
    returnDialogMock(props);
    return props.open ? <div data-testid="return-dialog-mock" /> : null;
  },
}));

const OWNER = { id: 'u1', role: 'network_owner', collection_point_id: null };
const OPERATOR = { id: 'u2', role: 'point_operator', collection_point_id: 'p1' };

const STANDING: CrateStanding = {
  collection_point_id: 'p1', allotment: 800, in_field: 195, deposit_units: 115,
  deposit_held: '13800.00', at_base: 264, on_hand: 341, shortfall: 459,
};

const row = (over: Partial<CrateBalanceRow> & Pick<CrateBalanceRow, 'supplier_id'>): CrateBalanceRow => ({
  first_name: 'Василь',
  last_name: 'Яремчук',
  is_active: true,
  collection_point_id: 'p1',
  outstanding_units: 40,
  deposit_held: '5000.00',
  has_receipt: false,
  deposit_units: 40,
  receipt_units: 0,
  ...over,
});

const page = (rows: CrateBalanceRow[]) => ({
  data: { data: rows, total: rows.length, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

/** The suite runs in ENGLISH (`test-setup.ts` calls `changeLanguage('en')`). */
beforeEach(() => {
  vi.clearAllMocks();
  meMock.mockReturnValue({ data: OPERATOR });
  scopeMock.mockReturnValue({ pointId: 'p1', canPick: false, setPointId: vi.fn() });
  pointsMock.mockReturnValue({
    data: [{ id: 'p1', name: 'Шипинки', target_crates: 120 }],
    isPending: false,
    isError: false,
  });
  standingMock.mockReturnValue({ data: STANDING, isPending: false, isError: false });
  balancesMock.mockReturnValue(page([row({ supplier_id: 's1' })]));
});

describe('CratesPage', () => {
  it('passes the server standing to the bar and the page total to the table', () => {
    standingMock.mockReturnValue({ data: STANDING, isPending: false, isError: false });
    balancesMock.mockReturnValue({ data: { data: [row({ supplier_id: 's1' })], total: 11, page: 1, limit: 100 }, isPending: false, isError: false });
    render(<CratesPage />);
    expect(screen.getByTestId('bar')).toHaveTextContent('195');
    expect(screen.getByTestId('table')).toHaveAttribute('data-holders', '11');
    expect(screen.getByTestId('table')).toHaveAttribute('data-truncated', 'true');
  });

  it('asks the owner to pick a point and fires nothing until they do', () => {
    meMock.mockReturnValue({ data: OWNER });
    scopeMock.mockReturnValue({ pointId: null, canPick: true, setPointId: vi.fn() });
    render(<CratesPage />);
    expect(screen.getByText(/no point selected/i)).toBeInTheDocument();
    expect(standingMock).toHaveBeenCalledWith({ pointId: null, isOwner: true });
  });

  it('keeps both gestures live', () => {
    render(<CratesPage />);
    expect(screen.getByRole('button', { name: /issue crates/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /accept crates/i })).toBeEnabled();
  });

  it('shows the empty state, not a table, when nobody holds crates', () => {
    balancesMock.mockReturnValue(page([]));
    render(<CratesPage />);
    expect(screen.getByText(/nobody is holding crates/i)).toBeInTheDocument();
    expect(screen.queryByTestId('table')).not.toBeInTheDocument();
  });

  it('says plainly that the shipments window is deferred', () => {
    render(<CratesPage />);
    expect(screen.getByText(/shipments today.*window is not built yet/i)).toBeInTheDocument();
  });

  it('opens the issue dialog without a point id for an operator', async () => {
    const user = userEvent.setup();
    render(<CratesPage />);

    await user.click(screen.getByRole('button', { name: /issue crates/i }));

    expect(screen.getByTestId('issue-dialog-mock')).toBeInTheDocument();
    // The operator's point comes from their TOKEN — sending one from the body
    // is what `point-scope.ts` refuses to accept from a request.
    expect(issueDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ pointId: undefined }),
    );
  });

  it('opens the return dialog', async () => {
    const user = userEvent.setup();
    render(<CratesPage />);
    await user.click(screen.getByRole('button', { name: /accept crates/i }));
    expect(screen.getByTestId('return-dialog-mock')).toBeInTheDocument();
  });

  it('flips includeZero when the "show everyone" switch is toggled, off by default', async () => {
    const user = userEvent.setup();
    render(<CratesPage />);
    expect(balancesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeZero: false }),
    );

    await user.click(screen.getByRole('switch', { name: /show everyone who took crates/i }));

    expect(balancesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeZero: true }),
    );
  });

  it('is accessible', async () => {
    const { container } = render(<CratesPage />);
    await expectNoAxeViolations(container);
  });
});

describe('CratesPage — the owner', () => {
  beforeEach(() => {
    meMock.mockReturnValue({ data: OWNER });
  });

  it('asks for a point before showing anything', () => {
    scopeMock.mockReturnValue({ pointId: null, canPick: true, setPointId: vi.fn() });
    balancesMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    standingMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<CratesPage />);
    expect(screen.getByText(/no point selected/i)).toBeInTheDocument();
  });

  it('passes the chosen point to the dialogs, since an owner has none of their own', async () => {
    const user = userEvent.setup();
    scopeMock.mockReturnValue({ pointId: 'p1', canPick: true, setPointId: vi.fn() });
    render(<CratesPage />);

    await user.click(screen.getByRole('button', { name: /issue crates/i }));

    expect(issueDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ pointId: 'p1' }),
    );
  });
});

describe('CratesPage — states', () => {
  it('reports a failed read rather than an empty table', () => {
    balancesMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<CratesPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('reports a failed standing read too', () => {
    standingMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<CratesPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('spins while loading', () => {
    balancesMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<CratesPage />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('spins while the standing is loading', () => {
    standingMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<CratesPage />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
