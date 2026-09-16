import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api';
import { ReturnCratesDialog } from './ReturnCratesDialog';
import type { CrateReturnPreview } from '@/entities/crate';

const { previewMock, acceptMock, suppliersMock } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  acceptMock: vi.fn(),
  suppliersMock: vi.fn(),
}));

vi.mock('../api/useReturnCrates', () => ({
  useReturnPreviewQuery: (args: unknown) => previewMock(args),
  useReturnCratesMutation: () => ({ mutateAsync: acceptMock }),
}));

vi.mock('@/entities/supplier', () => ({
  useSuppliersQuery: () => suppliersMock(),
  supplierName: (s: { first_name: string; last_name: string }) =>
    `${s.first_name} ${s.last_name}`,
}));

/** §6.5's own case: 20 taken at 120, 20 at 130; 25 come back. */
const SPLIT: CrateReturnPreview = {
  allocations: [
    {
      issuance_id: 'i1',
      code: 'SHP-CR-0001',
      units: 20,
      per_unit: '120.00',
      amount: '2400.00',
      mode: 'deposit',
    },
    {
      issuance_id: 'i2',
      code: 'SHP-CR-0002',
      units: 5,
      per_unit: '130.00',
      amount: '650.00',
      mode: 'deposit',
    },
  ],
  deposit_refund: '3050.00',
  shortfall: 0,
};

const idle = { data: undefined, isFetching: false, isError: false };
const ready = (data: CrateReturnPreview) => ({ data, isFetching: false, isError: false });

function open() {
  return render(<ReturnCratesDialog open onClose={() => {}} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  suppliersMock.mockReturnValue({
    data: { data: [{ id: 's1', first_name: 'Василь', last_name: 'Яремчук' }], total: 1 },
    isPending: false,
    isError: false,
  });
  previewMock.mockReturnValue(idle);
  acceptMock.mockResolvedValue({});
});

describe('ReturnCratesDialog', () => {
  it('asks for nothing until a person and a count are chosen', () => {
    open();
    expect(screen.getByText(/choose a person and a number/i)).toBeInTheDocument();
  });

  /**
   * THE POINT OF THIS DIALOG. §6.5 never asks the operator which tranche a
   * return comes from, so the screen must SHOW the choice the server made —
   * otherwise a refund of 3 050 ₴ on 25 crates is explained by neither 120 nor
   * 130.
   */
  it('renders the SERVER tranche split, each at the price it was taken at', () => {
    previewMock.mockReturnValue(ready(SPLIT));
    open();

    expect(screen.getByText('SHP-CR-0001')).toBeInTheDocument();
    expect(screen.getByText('SHP-CR-0002')).toBeInTheDocument();
    expect(screen.getByText(/at .*120/)).toBeInTheDocument();
    expect(screen.getByText(/at .*130/)).toBeInTheDocument();
  });

  it('shows the refund the server computed, not one of its own', () => {
    previewMock.mockReturnValue(ready(SPLIT));
    open();
    // 3 050.00 — never recomputed here from units x price.
    expect(screen.getByText(/3[,\s]?050\.00/)).toBeInTheDocument();
  });

  /** §6.4 — a розписка tranche refunds nothing, and the row says so. */
  it('shows a receipt tranche as returning no money', () => {
    previewMock.mockReturnValue(
      ready({
        allocations: [
          {
            issuance_id: 'i3',
            code: 'SHP-CR-0003',
            units: 10,
            per_unit: '0.00',
            amount: '0.00',
            mode: 'receipt',
          },
        ],
        deposit_refund: '0.00',
        shortfall: 0,
      }),
    );
    open();

    const line = screen.getByText('SHP-CR-0003').closest('li')!;
    expect(within(line).getByText(/on a receipt, no money/i)).toBeInTheDocument();
    expect(within(line).getByText('—')).toBeInTheDocument();
  });

  /**
   * Named, never clamped: the server refuses this write outright, and the
   * operator should learn it before counting crates into a stack.
   */
  it('names a shortfall and blocks the write instead of silently clamping', () => {
    previewMock.mockReturnValue(ready({ ...SPLIT, shortfall: 5 }));
    open();

    expect(screen.getByText(/5 crates more than this person ever took/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^accept$/i })).toBeDisabled();
  });

  it('keeps the button live when the split covers the request', () => {
    previewMock.mockReturnValue(ready(SPLIT));
    open();
    expect(screen.getByRole('button', { name: /^accept$/i })).toBeEnabled();
  });

  it('sends the person and a whole number of crates', async () => {
    const user = userEvent.setup();
    previewMock.mockReturnValue(ready(SPLIT));
    open();

    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '25');
    await user.click(screen.getByRole('button', { name: /^accept$/i }));

    await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(1));
    expect(acceptMock).toHaveBeenCalledWith({ supplier_id: 's1', units: 25 });
  });

  it('refuses a fractional count before the server sees it', async () => {
    const user = userEvent.setup();
    open();

    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '2.5');
    await user.click(screen.getByRole('button', { name: /^accept$/i }));

    await waitFor(() =>
      expect(screen.getByText(/whole number of crates/i)).toBeInTheDocument(),
    );
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it('names an insufficient crate drawer rather than showing a generic failure', async () => {
    const user = userEvent.setup();
    previewMock.mockReturnValue(ready(SPLIT));
    acceptMock.mockRejectedValue(
      new ApiError(409, 'not enough', undefined, 'CRATE_CASH_INSUFFICIENT'),
    );
    open();

    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '25');
    await user.click(screen.getByRole('button', { name: /^accept$/i }));

    await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText(/drawer holds less/i)).toBeInTheDocument(),
    );
  });

  it('reports a failed preview instead of showing a stale split', () => {
    previewMock.mockReturnValue({ data: undefined, isFetching: false, isError: true });
    open();
    expect(screen.getByText(/could not work out the split/i)).toBeInTheDocument();
  });
});
