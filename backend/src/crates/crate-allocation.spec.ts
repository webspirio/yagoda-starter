import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { allocate, CrateTranche } from './crate-allocation';

const deposit = (id: string, units: number, perUnit: string): CrateTranche => ({
  issuance_id: id,
  remaining_units: units,
  per_unit: perUnit,
  mode: CrateIssuanceMode.Deposit,
});

const receipt = (id: string, units: number): CrateTranche => ({
  issuance_id: id,
  remaining_units: units,
  per_unit: '0.00',
  mode: CrateIssuanceMode.Receipt,
});

describe('allocate', () => {
  /** §6.5, the rule's own example, number for number. */
  it('consumes the oldest tranche first and refunds ITS price', () => {
    const result = allocate([deposit('jul18', 20, '120.00'), deposit('jul28', 20, '130.00')], 7);

    expect(result.allocations).toEqual([
      { issuance_id: 'jul18', units: 7, per_unit: '120.00', amount: '840.00' },
    ]);
    expect(result.deposit_refund).toBe('840.00');
    expect(result.shortfall).toBe(0);
  });

  it('spans tranches when the first cannot cover the request', () => {
    const result = allocate([deposit('jul18', 20, '120.00'), deposit('jul28', 20, '130.00')], 25);

    expect(result.allocations).toEqual([
      { issuance_id: 'jul18', units: 20, per_unit: '120.00', amount: '2400.00' },
      { issuance_id: 'jul28', units: 5, per_unit: '130.00', amount: '650.00' },
    ]);
    expect(result.deposit_refund).toBe('3050.00');
  });

  /**
   * Spec §4.1 — the queue is single and spans modes, and the money still does
   * not mix. The receipt tranche contributes crates and 0,00 ₴.
   */
  it('interleaves receipt tranches by date and refunds nothing for them', () => {
    const result = allocate(
      [deposit('jul18', 20, '120.00'), receipt('jul24', 30), deposit('jul28', 20, '130.00')],
      45,
    );

    expect(result.allocations).toEqual([
      { issuance_id: 'jul18', units: 20, per_unit: '120.00', amount: '2400.00' },
      { issuance_id: 'jul24', units: 25, per_unit: '0.00', amount: '0.00' },
    ]);
    expect(result.deposit_refund).toBe('2400.00');
  });

  it('exhausts a tranche exactly without touching the next', () => {
    const result = allocate([deposit('a', 20, '120.00'), deposit('b', 20, '130.00')], 20);

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]).toEqual({
      issuance_id: 'a',
      units: 20,
      per_unit: '120.00',
      amount: '2400.00',
    });
  });

  it('spans three tranches', () => {
    const result = allocate(
      [deposit('a', 2, '10.00'), deposit('b', 2, '20.00'), deposit('c', 2, '30.00')],
      6,
    );

    expect(result.allocations.map((r) => r.amount)).toEqual(['20.00', '40.00', '60.00']);
    expect(result.deposit_refund).toBe('120.00');
  });

  it('handles a one-unit return', () => {
    const result = allocate([deposit('a', 20, '120.00')], 1);
    expect(result.deposit_refund).toBe('120.00');
  });

  /**
   * ROUNDING IS PER ROW, THEN SUMMED — the repo's rule, held here even though
   * THIS DOMAIN CANNOT PRODUCE A DISAGREEMENT. A scale-2 price times an INTEGER
   * unit count is exact, so `round(Σ)` always equals `Σ round(each)` for
   * crates; `intakes` is where the kopiyka actually moves, because its
   * quantities are weights with decimals.
   *
   * The test asserts exactness rather than pretending otherwise. The per-row
   * discipline stays in the implementation so that the day a fractional
   * quantity appears here, the rows the supplier can check are already the
   * rows being summed.
   */
  it('produces exact per-row amounts that sum to the refund', () => {
    const result = allocate([deposit('a', 3, '0.33'), deposit('b', 3, '0.67')], 6);

    expect(result.allocations.map((r) => r.amount)).toEqual(['0.99', '2.01']);
    expect(result.deposit_refund).toBe('3.00');
  });

  it('reports a shortfall rather than inventing tranches', () => {
    const result = allocate([deposit('a', 20, '120.00')], 25);

    expect(result.shortfall).toBe(5);
    expect(result.allocations).toHaveLength(1);
    expect(result.deposit_refund).toBe('2400.00');
  });

  it('reports the whole request as a shortfall when nothing is outstanding', () => {
    const result = allocate([], 10);

    expect(result.shortfall).toBe(10);
    expect(result.allocations).toEqual([]);
    expect(result.deposit_refund).toBe('0.00');
  });

  it('skips exhausted tranches', () => {
    const result = allocate([deposit('a', 0, '120.00'), deposit('b', 5, '130.00')], 3);

    expect(result.allocations).toEqual([
      { issuance_id: 'b', units: 3, per_unit: '130.00', amount: '390.00' },
    ]);
  });
});
