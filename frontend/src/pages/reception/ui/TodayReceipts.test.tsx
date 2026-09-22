import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Intake } from '@/entities/intake';
import { formatTime } from '@/shared/lib/date';
import { formatKg, formatUah } from '@/shared/lib/money';
import { TodayReceipts } from './TodayReceipts';

const { intakesMock } = vi.hoisted(() => ({ intakesMock: vi.fn() }));

vi.mock('@/entities/intake', () => ({
  useIntakesQuery: (filter: unknown) => intakesMock(filter),
}));

const intake = (over: Partial<Intake> & Pick<Intake, 'id' | 'created_at'>): Intake => ({
  code: 'SHP-IN-20260921-00001',
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-21',
  supplier_id: 's1',
  received_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  net_kg: '0.00',
  lines_count: 1,
  supplier_name: '—',
  amount: '0.00',
  paid_amount: '0.00',
  ...over,
});

// Ніна's receipt: two lines, a partial cash payout, so «залишок» reads.
const NINA = intake({
  id: 'i1',
  created_at: '2026-09-21T09:15:00Z',
  supplier_name: 'Ніна Ільчук',
  net_kg: '36.90',
  lines_count: 2,
  amount: '15000.00',
  paid_amount: '10000.00',
});

// Voided, single line, fully paid — proves the voided styling AND that a
// single line never gets a «N positions» suffix.
const VOIDED = intake({
  id: 'i2',
  created_at: '2026-09-21T08:00:00Z',
  supplier_name: 'Petro Kotyk',
  net_kg: '20.00',
  lines_count: 1,
  amount: '2000.00',
  paid_amount: '2000.00',
  voided_at: '2026-09-21T10:00:00Z',
});

// A second LIVE receipt, fully settled — its own kg still counts toward the
// header's live tonnage even though it carries no «залишок».
const OLEH = intake({
  id: 'i3',
  created_at: '2026-09-21T07:30:00Z',
  supplier_name: 'Oleh Marchuk',
  net_kg: '10.10',
  lines_count: 1,
  amount: '500.00',
  paid_amount: '500.00',
});

// Voided, but would owe a «залишок» if it were live (100.00 amount, nothing
// paid) — proves the amber badge is gated on `voided_at === null`, not just
// on the arithmetic.
const VOIDED_WITH_GAP = intake({
  id: 'i4',
  created_at: '2026-09-21T06:00:00Z',
  supplier_name: 'Iryna Sokil',
  net_kg: '5.00',
  lines_count: 1,
  amount: '100.00',
  paid_amount: '0.00',
  voided_at: '2026-09-21T11:00:00Z',
});

const page = (data: Intake[]) => ({
  data: { data, total: data.length, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

beforeEach(() => {
  intakesMock.mockReset().mockReturnValue(page([]));
});

describe('TodayReceipts — a row reads like the mock', () => {
  it('shows the time, the supplier, the line count, the kilos, the remainder and the amount', () => {
    intakesMock.mockReturnValue(page([NINA, VOIDED, OLEH]));
    render(<TodayReceipts shiftId="s1" onOpen={vi.fn()} />);

    expect(screen.getByText(formatTime(NINA.created_at, 'en'))).toBeInTheDocument();
    expect(screen.getByText('Ніна Ільчук')).toBeInTheDocument();
    expect(screen.getByText('2 positions')).toBeInTheDocument();
    expect(screen.getByText(formatKg('36.90', 'en'))).toBeInTheDocument();

    const remainder = screen.getByText('remainder ' + formatUah('5000.00', 'en'));
    expect(remainder).toHaveClass('text-amber');

    expect(screen.getByText(formatUah('15000.00', 'en'))).toBeInTheDocument();
  });

  it('shows no «N positions» suffix and no remainder for a single, fully-paid line', () => {
    intakesMock.mockReturnValue(page([OLEH]));
    render(<TodayReceipts shiftId="s1" onOpen={vi.fn()} />);

    expect(screen.queryByText(/position/)).not.toBeInTheDocument();
    expect(screen.queryByText(/remainder/)).not.toBeInTheDocument();
  });

  it('still lists a voided receipt, struck through, without it counting toward the header', () => {
    intakesMock.mockReturnValue(page([NINA, VOIDED, OLEH]));
    render(<TodayReceipts shiftId="s1" onOpen={vi.fn()} />);

    expect(screen.getByText('Petro Kotyk')).toBeInTheDocument();
    expect(screen.getByText('voided')).toBeInTheDocument();

    // Live count badge: 2 (Ніна + Oleh) — the voided row excluded.
    expect(screen.getByText('2')).toBeInTheDocument();
    // Live tonnage: 36.90 + 10.10 = 47.00 kg — the voided 20.00 excluded.
    expect(screen.getByText(formatKg('47.00', 'en'))).toBeInTheDocument();
  });

  it('never shows the amber remainder on a voided receipt, even when the amount was never paid', () => {
    intakesMock.mockReturnValue(page([NINA, VOIDED_WITH_GAP]));
    render(<TodayReceipts shiftId="s1" onOpen={vi.fn()} />);

    // The live row (Ніна) still reads its remainder…
    expect(screen.getByText('remainder ' + formatUah('5000.00', 'en'))).toBeInTheDocument();
    // …but the voided row's own would-be remainder (100.00 − 0.00) does not.
    expect(screen.getByText('Iryna Sokil')).toBeInTheDocument();
    expect(
      screen.queryByText('remainder ' + formatUah('100.00', 'en')),
    ).not.toBeInTheDocument();
  });

  it('scrolls a tall list instead of growing the page', () => {
    intakesMock.mockReturnValue(page([NINA]));
    const { container } = render(<TodayReceipts shiftId="s1" onOpen={vi.fn()} />);
    expect(container.querySelector('.max-h-\\[560px\\].overflow-y-auto')).toBeInTheDocument();
  });
});
