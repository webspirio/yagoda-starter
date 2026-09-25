import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { i18n } from '@/shared/lib/i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import type { CrateAllocation, CrateReturnPreview } from '@/entities/crate';
import { ConfirmRefundDialog } from './ConfirmRefundDialog';

const { previewMock, refetchMock } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  refetchMock: vi.fn(),
}));

vi.mock('@/features/return-crates', () => ({
  useReturnPreviewQuery: (input: { supplierId: string | null; units: number; pointId?: string }) =>
    previewMock(input),
}));

const alloc = (mode: 'deposit' | 'receipt', units: number, amount: string): CrateAllocation => ({
  issuance_id: `${mode}-${units}`,
  units,
  per_unit: mode === 'deposit' ? '120.00' : '0.00',
  amount,
  mode,
  code: `C-${mode}`,
});

const DEPOSIT_ONLY: CrateReturnPreview = {
  allocations: [alloc('deposit', 50, '6000.00')],
  deposit_refund: '6000.00',
  shortfall: 0,
};
const MIXED: CrateReturnPreview = {
  allocations: [alloc('deposit', 20, '2400.00'), alloc('receipt', 20, '0.00')],
  deposit_refund: '2400.00',
  shortfall: 0,
};
const RECEIPT_ONLY: CrateReturnPreview = {
  allocations: [alloc('receipt', 20, '0.00')],
  deposit_refund: '0.00',
  shortfall: 0,
};

const settled = (data: CrateReturnPreview) => ({
  data,
  isFetching: false,
  isError: false,
  refetch: refetchMock,
});

function renderDialog(props: Partial<Parameters<typeof ConfirmRefundDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmRefundDialog
      supplierId="s1"
      units={50}
      paid="5000.00"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
}

beforeEach(() => {
  previewMock.mockReset().mockReturnValue(settled(DEPOSIT_ONLY));
  refetchMock.mockReset();
});

describe('ConfirmRefundDialog', () => {
  it('lists both sums with the drawer each comes from, and carries the deposit on the button', () => {
    renderDialog();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Hand the person two sums');
    expect(screen.getByText(/For berries/)).toHaveTextContent(
      'For berries — 5,000.00 ₴ from the berry drawer',
    );
    expect(screen.getByText(/Deposit for/)).toHaveTextContent(
      'Deposit for 50 crates — 6,000.00 ₴ from the crates drawer',
    );
    expect(
      screen.getByRole('button', { name: 'Handed over 6,000.00 ₴' }),
    ).toBeEnabled();
  });

  it('asks for the preview of exactly these crates', () => {
    renderDialog({ pointId: 'p1', units: 50 });
    expect(previewMock).toHaveBeenCalledWith({ supplierId: 's1', units: 50, pointId: 'p1' });
  });

  it('leaves out the berry line when nothing is paid for berries', () => {
    renderDialog({ paid: null });
    expect(screen.queryByText(/For berries/)).toBeNull();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Hand back the deposit');
  });

  it('adds a no-money line for the crates taken on a receipt in a mixed return', () => {
    previewMock.mockReturnValue(settled(MIXED));
    renderDialog({ units: 40 });
    expect(screen.getByText(/Deposit for/)).toHaveTextContent(
      'Deposit for 20 crates — 2,400.00 ₴ from the crates drawer',
    );
    expect(screen.getByText('20 crates on a receipt — no money')).toBeInTheDocument();
  });

  it('focuses «Back», so a habitual Enter does not accept', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus());
  });

  it('confirms once, and the close that follows a confirm is not a cancel', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderDialog();
    await user.click(screen.getByRole('button', { name: /Handed over/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels on «Back» without confirming', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables the confirm while the preview is being refreshed', () => {
    previewMock.mockReturnValue({ ...settled(DEPOSIT_ONLY), isFetching: true });
    renderDialog();
    expect(screen.getByText('Working out the deposit…')).toBeInTheDocument();
    expect(screen.queryByText(/Deposit for/)).toBeNull();
    expect(screen.getByRole('button', { name: /Handed over|Accept/ })).toBeDisabled();
  });

  it('disables the confirm when the preview failed, and retries on request', async () => {
    previewMock.mockReturnValue({ ...settled(DEPOSIT_ONLY), isError: true });
    const user = userEvent.setup();
    renderDialog();
    expect(screen.getByText('Could not work out the deposit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Handed over|Accept/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not ask at all when the fresh preview has no money — submits straight away', async () => {
    previewMock.mockReturnValue(settled(RECEIPT_ONLY));
    const { onConfirm } = renderDialog({ units: 20 });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  describe('in Ukrainian', () => {
    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    it('declines «ящик» and names both drawers', async () => {
      await i18n.changeLanguage('uk');
      previewMock.mockReturnValue(
        settled({
          allocations: [alloc('deposit', 22, '2640.00'), alloc('receipt', 21, '0.00')],
          deposit_refund: '2640.00',
          shortfall: 0,
        }),
      );
      renderDialog({ units: 43 });
      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent('Видайте людині дві суми');
      expect(dialog).toHaveTextContent('За ягоду — 5 000,00 ₴ з каси за ягоду');
      expect(dialog).toHaveTextContent('Завдаток за 22 ящики — 2 640,00 ₴ з каси за ящики');
      expect(dialog).toHaveTextContent('21 ящик за розпискою — без грошей');
      // `\s`, not a literal space: the uk group separator is Intl's own
      // (a narrow no-break space), which an accessible name keeps verbatim.
      expect(
        screen.getByRole('button', { name: /^Видав 2\s640,00 ₴$/ }),
      ).toBeInTheDocument();
    });
  });

  it('has no axe violations', async () => {
    renderDialog();
    await expectNoAxeViolations(document.body);
  });
});
