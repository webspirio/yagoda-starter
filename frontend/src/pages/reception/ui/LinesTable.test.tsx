import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LinesTable, type CommittedLine } from './LinesTable';

/** Two committed lines, straight off a server preview (§2.4/§2.8/§2.9) — the
 *  same shape `ReceptionPage` hands the table. Line 1 carries 3 crates worth
 *  3,60 kg of tare; line 2 two tare rows and a −2,00 ₴/kg discount. Each row
 *  must re-check on a calculator (R5): Брутто − Піддон − Тара (kg) = Нетто,
 *  × the FINAL price = Сума. */
const ROWS: CommittedLine[] = [
  {
    key: 'line-1',
    gradeLabel: 'Raspberry · Grade 1',
    item: {
      item_order: 1,
      product_grade_id: 'g1',
      gross_kg: '30.00',
      pallet_kg: '0.00',
      tare_weight_kg: '3.60',
      net_kg: '26.40',
      price: '10.00',
      bonus: '0.00',
      amount: '264.00',
      amount_exact: '264.00',
      tare: [{ tare_type_id: 't1', units: 3 }],
    },
  },
  {
    key: 'line-2',
    gradeLabel: 'Raspberry · Grade 2',
    item: {
      item_order: 2,
      product_grade_id: 'g2',
      gross_kg: '32.30',
      pallet_kg: '0.00',
      tare_weight_kg: '3.00',
      net_kg: '29.30',
      price: '8.00',
      bonus: '-2.00',
      amount: '175.80',
      amount_exact: '175.80',
      tare: [
        { tare_type_id: 't1', units: 1 },
        { tare_type_id: 't0', units: 1 },
      ],
    },
  },
];

describe('LinesTable — reads like the mock', () => {
  it('shows the tare in kg (units in its title) and the final price, so a row re-checks (R5)', () => {
    render(<LinesTable rows={ROWS} disabled={false} onRemove={vi.fn()} />);

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    const line1 = rows[1];
    const line2 = rows[2];

    // 30.00 − 3.60 = 26.40: the tare cell is the WEIGHT, the count rides in its title.
    const tare1 = within(line1).getByText('3.60');
    expect(tare1).toHaveAttribute('title', '3 tare units');
    expect(within(line1).queryByText('3')).not.toBeInTheDocument();
    // Two tare rows, one unit each — 3.00 kg, two units in the title.
    expect(within(line2).getByText('3.00')).toHaveAttribute('title', '2 tare units');

    // Line 1 has no bonus — the price is the grade's.
    expect(within(line1).getByText('10.00')).toBeInTheDocument();

    // Line 2's −2.00 is folded into the price: 8.00 − 2.00 = 6.00, no separate bonus.
    expect(within(line2).getByText('6.00')).toBeInTheDocument();
    expect(within(line2).queryByText('8.00')).not.toBeInTheDocument();
    expect(within(line2).queryByText('−2.00')).not.toBeInTheDocument();
  });

  // The table keeps its room for eight rows even when empty (client, 24.10),
  // so it shows its header and no line rows.
  it('keeps the header and no line rows without committed rows', () => {
    render(<LinesTable rows={[]} disabled={false} onRemove={vi.fn()} />);

    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(1);
  });
});
