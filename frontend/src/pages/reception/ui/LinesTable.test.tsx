import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LinesTable, type CommittedLine } from './LinesTable';

/** Two committed lines, straight off a server preview (§2.4/§2.8/§2.9) — the
 *  same shape `ReceptionPage` hands the table. Line 1 carries 3 crates worth
 *  3,60 kg of tare (proving the «Тара» column now counts UNITS, not weight);
 *  line 2 carries a −2,00 ₴/kg discount, which the «Ціна» cell must show as a
 *  signed, amber addition to the price. Net weights sum to 55,70 kg. */
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
      tare: [
        { tare_type_id: 't1', units: 1 },
        { tare_type_id: 't0', units: 1 },
      ],
    },
  },
];

describe('LinesTable — reads like the mock', () => {
  it('shows unit counts in the tare column, a signed amber bonus in the price cell, and the line/kg counter', () => {
    render(
      <LinesTable
        rows={ROWS}
        canAdd={false}
        atCap={false}
        disabled={false}
        lineCount={2}
        netKg="55.70"
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    const line1 = rows[1];
    const line2 = rows[2];

    // The tare cell reads the UNIT COUNT (3), never the tare weight (3.60).
    expect(within(line1).getByText('3')).toBeInTheDocument();
    expect(within(line1).queryByText('3.60')).not.toBeInTheDocument();
    // Two tare rows, one unit each — still a plain count, not 3.00.
    expect(within(line2).getByText('2')).toBeInTheDocument();

    // Line 1 has no bonus — the price cell shows only the price.
    expect(within(line1).getByText('10.00')).toBeInTheDocument();

    // Line 2's discount renders as a signed, amber addition to the price.
    expect(within(line2).getByText('8.00')).toBeInTheDocument();
    const bonus = within(line2).getByText('−2.00');
    expect(bonus).toHaveClass('text-amber');

    // The «Add line» row's right-aligned counter.
    expect(screen.getByText('2 lines · 55.70 kg')).toBeInTheDocument();
  });

  it('shows no counter while there is no settled net weight yet', () => {
    render(
      <LinesTable
        rows={ROWS}
        canAdd={false}
        atCap={false}
        disabled={false}
        lineCount={2}
        netKg={null}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.queryByText(/lines? ·/)).not.toBeInTheDocument();
  });
});
