import { describe, it, expect } from 'vitest';
import { tareWeightOf, netOf, newDraftKey } from './draft';

const WEIGHTS = new Map([
  ['t-crate', '1.20'],
  ['t-box', '0.35'],
]);

describe('tareWeightOf', () => {
  it('sums each tare type at its catalogue weight', () => {
    expect(tareWeightOf([{ tare_type_id: 't-crate', units: 10 }], WEIGHTS)).toBe('12.00');
  });

  it('adds several tare types on one line', () => {
    expect(
      tareWeightOf(
        [{ tare_type_id: 't-crate', units: 10 }, { tare_type_id: 't-box', units: 3 }],
        WEIGHTS,
      ),
    ).toBe('13.05');
  });

  it('is zero with no tare — the mock warns about this, it does not compute around it', () => {
    expect(tareWeightOf([], WEIGHTS)).toBe('0.00');
  });

  it('ignores a tare type the catalogue does not carry rather than guessing a weight', () => {
    expect(tareWeightOf([{ tare_type_id: 'gone', units: 10 }], WEIGHTS)).toBe('0.00');
  });
});

describe('netOf', () => {
  it('subtracts the pallet FIRST, then the tare (§8.1)', () => {
    expect(netOf('701.50', '20.00', '12.00')).toBe('669.50');
  });

  it('can go negative — the screen blocks on that, the arithmetic does not lie about it', () => {
    expect(netOf('10.00', '8.00', '5.00')).toBe('-3.00');
  });

  it('holds a value a float would drift on', () => {
    expect(netOf('0.30', '0.10', '0.00')).toBe('0.20');
  });
});

describe('newDraftKey', () => {
  it('does not repeat', () => {
    const keys = new Set(Array.from({ length: 200 }, newDraftKey));
    expect(keys.size).toBe(200);
  });
});
