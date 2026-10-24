import { describe, it, expect } from 'vitest';
import { i18n } from '@/shared/lib/i18n';
import { netFormula } from './formula';

const t = i18n.t.bind(i18n);

describe('netFormula — W4', () => {
  it('prints one term per tare type when every per-unit weight is known', () => {
    expect(
      netFormula(t, 'en', {
        gross: '300.60',
        pallet: '15.60',
        tare: [
          { units: 48, unitWeightKg: '1.20' },
          { units: 8, unitWeightKg: '0.30' },
        ],
        tareKg: '60.00',
        net: '225.00',
      }),
    ).toBe('300.60 − 15.60 − 48 × 1.20 − 8 × 0.30 = 225.00');
  });

  it('prints the stored tare total when any per-unit weight is unknown', () => {
    expect(
      netFormula(t, 'en', {
        gross: '300.60',
        pallet: '0.00',
        tare: [
          { units: 48, unitWeightKg: '1.20' },
          { units: 8, unitWeightKg: null },
        ],
        tareKg: '60.00',
        net: '240.60',
      }),
    ).toBe('300.60 − 60.00 tare = 240.60');
  });

  it('says nothing when nothing is subtracted', () => {
    expect(
      netFormula(t, 'en', { gross: '50.00', pallet: '0.00', tare: [], tareKg: '0.00', net: '50.00' }),
    ).toBeNull();
  });
});
