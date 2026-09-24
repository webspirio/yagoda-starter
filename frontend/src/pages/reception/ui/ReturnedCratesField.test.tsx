import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import type { CrateBalance, CrateReturnPreview } from '@/entities/crate';
import { ReturnedCratesField } from './ReturnedCratesField';

const { balanceMock, previewMock } = vi.hoisted(() => ({
  balanceMock: vi.fn(),
  previewMock: vi.fn(),
}));

vi.mock('@/entities/crate', () => ({
  useCrateBalanceQuery: (supplierId: string | null) => balanceMock(supplierId),
}));

vi.mock('@/features/return-crates', () => ({
  useReturnPreviewQuery: (input: { supplierId: string | null; units: number; pointId?: string }) =>
    previewMock(input),
}));

const holding = (outstanding_units: number): { data: CrateBalance } => ({
  data: { supplier_id: 's1', outstanding_units, deposit_held: '0.00', tranches: [] },
});

const DEPOSIT: CrateReturnPreview = { allocations: [], deposit_refund: '3600.00', shortfall: 0 };
const RECEIPT: CrateReturnPreview = { allocations: [], deposit_refund: '0.00', shortfall: 0 };

/** The page's side of the contract: it owns the value (RHF), the field owns
 *  the pre-fill and the clamp. `tare` is lifted so a test can raise it. */
function Harness({
  supplierId = 's1',
  initialTare,
  onValue,
}: {
  supplierId?: string | null;
  initialTare: number;
  onValue?: (v: string) => void;
}) {
  const [value, setValue] = useState('');
  const [tare, setTare] = useState(initialTare);
  return (
    <>
      <ReturnedCratesField
        supplierId={supplierId}
        crateTareUnits={tare}
        value={value}
        onChange={(v) => {
          setValue(v);
          onValue?.(v);
        }}
      />
      <button type="button" onClick={() => setTare(tare + 10)}>
        more-tare
      </button>
      <button type="button" onClick={() => setTare(tare - 25)}>
        less-tare
      </button>
    </>
  );
}

const input = () => screen.getByLabelText('Of them, our crates') as HTMLInputElement;

beforeEach(() => {
  balanceMock.mockReset().mockReturnValue(holding(30));
  previewMock.mockReset().mockReturnValue({ data: undefined });
});

describe('ReturnedCratesField', () => {
  it('is hidden when the supplier holds none of our crates', () => {
    balanceMock.mockReturnValue(holding(0));
    render(<Harness initialTare={40} />);
    expect(screen.queryByLabelText('Of them, our crates')).toBeNull();
  });

  it('is hidden when no supplier is picked', () => {
    render(<Harness supplierId={null} initialTare={40} />);
    expect(screen.queryByLabelText('Of them, our crates')).toBeNull();
    expect(balanceMock).toHaveBeenCalledWith(null);
  });

  it('pre-fills min(crate tare, crates held) and says how many the person holds', async () => {
    render(<Harness initialTare={40} />);
    await waitFor(() => expect(input().value).toBe('30'));
    expect(screen.getByText('of the 30 crates this person holds')).toBeTruthy();
  });

  it('follows the crate tare while untouched', async () => {
    const user = userEvent.setup();
    render(<Harness initialTare={12} />);
    await waitFor(() => expect(input().value).toBe('12'));
    await user.click(screen.getByText('more-tare'));
    await waitFor(() => expect(input().value).toBe('22'));
  });

  it('keeps an edited value when the tare rises', async () => {
    const user = userEvent.setup();
    render(<Harness initialTare={20} />);
    await waitFor(() => expect(input().value).toBe('20'));
    await user.clear(input());
    await user.type(input(), '10');
    await user.click(screen.getByText('more-tare'));
    expect(input().value).toBe('10');
  });

  it('accepts digits only', async () => {
    const user = userEvent.setup();
    render(<Harness initialTare={40} />);
    await waitFor(() => expect(input().value).toBe('30'));
    await user.clear(input());
    await user.type(input(), '1a-2');
    expect(input().value).toBe('12');
  });

  it('clamps a typed value above the maximum on blur, not while typing', async () => {
    const user = userEvent.setup();
    render(<Harness initialTare={40} />);
    await waitFor(() => expect(input().value).toBe('30'));
    await user.clear(input());
    await user.type(input(), '50');
    expect(input().value).toBe('50');
    await user.tab();
    expect(input().value).toBe('30');
  });

  it('clamps an edited value when the maximum drops below it', async () => {
    const user = userEvent.setup();
    render(<Harness initialTare={40} />);
    await waitFor(() => expect(input().value).toBe('30'));
    await user.clear(input());
    await user.type(input(), '25');
    await user.click(screen.getByText('less-tare'));
    await waitFor(() => expect(input().value).toBe('15'));
  });

  it('shows the deposit the server would refund for these crates', async () => {
    previewMock.mockImplementation((args: { units: number }) => ({
      data: args.units > 0 ? DEPOSIT : undefined,
    }));
    render(<Harness initialTare={40} />);
    expect(await screen.findByText(/deposit to refund/)).toBeTruthy();
    expect(previewMock).toHaveBeenLastCalledWith({
      supplierId: 's1',
      units: 30,
      pointId: undefined,
    });
  });

  it('says there is no money when the crates were taken on a receipt', async () => {
    previewMock.mockImplementation((args: { units: number }) => ({
      data: args.units > 0 ? RECEIPT : undefined,
    }));
    render(<Harness initialTare={40} />);
    expect(await screen.findByText('on a receipt, no money')).toBeTruthy();
  });

  it('shows no preview while the value is zero', async () => {
    previewMock.mockReturnValue({ data: DEPOSIT });
    render(<Harness initialTare={0} />);
    await waitFor(() => expect(input().value).toBe('0'));
    expect(screen.queryByText(/deposit to refund/)).toBeNull();
  });

  it('has no axe violations', async () => {
    previewMock.mockReturnValue({ data: DEPOSIT });
    const { container } = render(<Harness initialTare={40} />);
    await waitFor(() => expect(input().value).toBe('30'));
    await expectNoAxeViolations(container);
  });
});
