import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import { CratesPage } from './CratesPage';
import type { CrateBalanceRow } from '@/entities/crate';

const { balancesMock, meMock, scopeMock, pointsMock, issueDialogMock, returnDialogMock } =
  vi.hoisted(() => ({
    balancesMock: vi.fn(),
    meMock: vi.fn(),
    scopeMock: vi.fn(),
    pointsMock: vi.fn(),
    issueDialogMock: vi.fn(),
    returnDialogMock: vi.fn(),
  }));

vi.mock('@/entities/crate', () => ({
  useCrateBalancesQuery: (args: unknown) => balancesMock(args),
}));

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
  usePointScope: () => scopeMock(),
}));

vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => pointsMock(),
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

const row = (over: Partial<CrateBalanceRow> & Pick<CrateBalanceRow, 'supplier_id'>): CrateBalanceRow => ({
  first_name: 'Василь',
  last_name: 'Яремчук',
  is_active: true,
  collection_point_id: 'p1',
  outstanding_units: 40,
  deposit_held: '5000.00',
  has_receipt: false,
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
  balancesMock.mockReturnValue(page([row({ supplier_id: 's1' })]));
});

describe('CratesPage', () => {
  it('shows the allotment and what is out with people', () => {
    render(<CratesPage />);
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getAllByText('40').length).toBeGreaterThan(0);
  });

  /**
   * §6.9 — «—» for a point without a target, because «нуль стверджував би, що
   * ящиків немає, тоді як ми просто не знаємо, скільки їх має бути».
   */
  it('shows «—» for an unset allotment, never 0', () => {
    pointsMock.mockReturnValue({
      data: [{ id: 'p1', name: 'Шипинки', target_crates: null }],
      isPending: false,
      isError: false,
    });
    render(<CratesPage />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  /** §6.1 — an allotment below what is already out WARNS, never blocks. */
  it('warns when more crates are out than the allotment, and keeps both gestures live', () => {
    pointsMock.mockReturnValue({
      data: [{ id: 'p1', name: 'Шипинки', target_crates: 30 }],
      isPending: false,
      isError: false,
    });
    render(<CratesPage />);

    expect(screen.getByText(/10 more crates are out/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /issue crates/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /accept crates/i })).toBeEnabled();
  });

  it('does not warn when the allotment is unset', () => {
    pointsMock.mockReturnValue({
      data: [{ id: 'p1', name: 'Шипинки', target_crates: null }],
      isPending: false,
      isError: false,
    });
    render(<CratesPage />);
    expect(screen.queryByText(/more crates are out/i)).not.toBeInTheDocument();
  });

  /**
   * The note on this screen is explicitly about this difference: crates taken
   * on a розписка have NO cash cover, and a zero would read as «the deposit
   * came back».
   */
  it('renders «—» in the deposit column for a receipt holder, never a zero', () => {
    balancesMock.mockReturnValue(
      page([
        row({
          supplier_id: 's2',
          first_name: 'Христина',
          last_name: 'Каленчук',
          outstanding_units: 200,
          deposit_held: '0.00',
          has_receipt: true,
        }),
      ]),
    );
    render(<CratesPage />);

    const line = screen.getByRole('row', { name: /Христина/ });
    expect(within(line).getByText('—')).toBeInTheDocument();
    expect(within(line).queryByText(/0\.00/)).not.toBeInTheDocument();
    expect(within(line).getByText(/receipt/i)).toBeInTheDocument();
  });

  it('totals the units column', () => {
    balancesMock.mockReturnValue(
      page([
        row({ supplier_id: 's1', outstanding_units: 40 }),
        row({ supplier_id: 's2', last_name: 'Інша', outstanding_units: 200, has_receipt: true }),
      ]),
    );
    render(<CratesPage />);

    const total = screen.getByRole('row', { name: /TOTAL/i });
    expect(within(total).getByText('240')).toBeInTheDocument();
  });

  it('says plainly that on-hand and shipments are not tracked yet', () => {
    render(<CratesPage />);
    expect(screen.getByText(/not tracked yet/i)).toBeInTheDocument();
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

  it('shows an empty state when nobody is holding crates', () => {
    balancesMock.mockReturnValue(page([]));
    render(<CratesPage />);
    expect(screen.getByText(/nobody is holding crates/i)).toBeInTheDocument();
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

  it('spins while loading', () => {
    balancesMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<CratesPage />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});

/**
 * A person can hold BOTH kinds at once — two issuances, two modes, one
 * balance. The first draft of this table branched on `has_receipt` alone and
 * would have printed «—» over real money.
 */
describe('CratesPage — a mixed holder', () => {
  it('shows the deposit that IS held, not a dash, when both kinds are out', () => {
    balancesMock.mockReturnValue(
      page([
        row({
          supplier_id: 's3',
          first_name: 'Змішаний',
          last_name: 'Тримач',
          outstanding_units: 60,
          deposit_held: '2400.00',
          has_receipt: true,
        }),
      ]),
    );
    render(<CratesPage />);

    const line = screen.getByRole('row', { name: /Змішаний/ });
    expect(within(line).queryByText('—')).not.toBeInTheDocument();
    expect(within(line).getByText(/2[,\s]?400\.00/)).toBeInTheDocument();
    expect(within(line).getByText(/deposit \+ receipt/i)).toBeInTheDocument();
  });

  it('still shows a dash when the receipt holder has no cash cover at all', () => {
    balancesMock.mockReturnValue(
      page([
        row({
          supplier_id: 's4',
          first_name: 'Лише',
          last_name: 'Розписка',
          outstanding_units: 200,
          deposit_held: '0.00',
          has_receipt: true,
        }),
      ]),
    );
    render(<CratesPage />);

    const line = screen.getByRole('row', { name: /Лише/ });
    expect(within(line).getByText('—')).toBeInTheDocument();
  });
});
