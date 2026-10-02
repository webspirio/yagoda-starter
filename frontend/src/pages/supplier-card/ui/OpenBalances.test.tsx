import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SettlementLine } from '@/entities/supplier';
import type { Intake } from '@/entities/intake';
import { OpenBalances } from './OpenBalances';

const line = (over: Partial<SettlementLine> & Pick<SettlementLine, 'id' | 'open'>): SettlementLine => ({
  kind: 'intake',
  code: over.id.toUpperCase(),
  intake_id: over.id,
  business_date: '2026-07-12',
  created_at: '2026-07-12T08:00:00.000Z',
  amount: over.open,
  paid: '0.00',
  covered_by: [],
  ...over,
});

const receipt = (id: string): Intake => ({
  id,
  code: id.toUpperCase(),
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-07-12',
  supplier_id: 'sup1',
  amount: '4200.00',
  received_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  shift_closed: false,
  created_at: '2026-07-12T08:00:00.000Z',
  net_kg: '41.20',
  lines_count: 1,
  supplier_name: 'Ніна Ільчук',
  paid_amount: '0.00',
  open_amount: '0.00',
});

describe('OpenBalances', () => {
  it('renders nothing when every line is closed and nothing is unallocated', () => {
    const { container } = render(
      <OpenBalances
        lines={[line({ id: 'r1', open: '0.00' })]}
        unallocated="0.00"
        intakesById={new Map()}
        locale="en" onOpenReceipt={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists open lines oldest first with the receipt kilograms when the receipt is loaded', () => {
    render(
      <OpenBalances
        lines={[
          line({ id: 'r1', open: '4200.00', business_date: '2026-07-12' }),
          line({ id: 'r2', open: '0.00', business_date: '2026-07-15' }),
          line({ id: 'r3', open: '800.00', business_date: '2026-07-20' }),
        ]}
        unallocated="0.00"
        intakesById={new Map([['r1', receipt('r1')]])}
        locale="en" onOpenReceipt={() => {}}
      />,
    );
    expect(screen.getByText('Open balances — what exactly is owed')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('R1');
    expect(rows[0]).toHaveTextContent('41.20 kg');
    expect(rows[0]).toHaveTextContent('4,200.00 ₴');
    expect(rows[1]).toHaveTextContent('R3');
    expect(screen.queryByText('R2')).not.toBeInTheDocument();
  });

  it('renders a row without a loaded receipt and without crashing', () => {
    render(
      <OpenBalances
        lines={[line({ id: 'r9', open: '10.00' })]}
        unallocated="0.00"
        intakesById={new Map()}
        locale="en" onOpenReceipt={() => {}}
      />,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('R9');
    expect(screen.getByRole('listitem')).not.toHaveTextContent('kg');
  });

  it('captions a top-up with its parent code', () => {
    render(
      <OpenBalances
        lines={[line({ id: 't1', kind: 'top_up', code: 'R1', intake_id: 'r1', open: '200.00' })]}
        unallocated="0.00"
        intakesById={new Map()}
        locale="en" onOpenReceipt={() => {}}
      />,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('Top-up on R1');
  });

  it('shows the overpayment as one row under the list, even with nothing open', () => {
    render(
      <OpenBalances lines={[]} unallocated="50.00" intakesById={new Map()} locale="en" onOpenReceipt={() => {}} />,
    );
    expect(screen.getByText('Overpayment — not allocated')).toBeInTheDocument();
    expect(screen.getByText('50.00 ₴')).toBeInTheDocument();
  });

  it('opens the receipt on click — a top-up opens its parent', async () => {
    const onOpenReceipt = vi.fn();
    render(
      <OpenBalances
        lines={[
          line({ id: 'r1', open: '100.00' }),
          line({ id: 't1', kind: 'top_up', code: 'R2', intake_id: 'r2', open: '200.00' }),
        ]}
        unallocated="0.00"
        intakesById={new Map()}
        locale="en"
        onOpenReceipt={onOpenReceipt}
      />,
    );
    const [receiptRow, topUpRow] = screen.getAllByRole('button');
    await userEvent.click(receiptRow);
    await userEvent.click(topUpRow);
    expect(onOpenReceipt.mock.calls).toEqual([['r1'], ['r2']]);
  });
});
