import { describe, it, expect } from 'vitest';
import { i18n } from '@/shared/lib/i18n';
import { netFormula, netParts } from './formula';

const t = i18n.t.bind(i18n);
// Each operand is held to its unit with a no-break space; compare as plain text.
const flat = (s: string | null) => s?.replace(/\u00a0/g, ' ') ?? null;

describe('netFormula — W4', () => {
  it('prints one term per tare type when every per-unit weight is known', () => {
    expect(
      flat(netFormula(t, 'en', {
        gross: '300.60',
        pallet: '15.60',
        tare: [
          { units: 48, unitWeightKg: '1.20' },
          { units: 8, unitWeightKg: '0.30' },
        ],
        tareKg: '60.00',
        net: '225.00',
      })),
    ).toBe('300.60 kg − 15.60 kg − 48 pcs × 1.20 kg − 8 pcs × 0.30 kg = 225.00 kg');
  });

  it('prints the stored tare total when any per-unit weight is unknown', () => {
    expect(
      flat(netFormula(t, 'en', {
        gross: '300.60',
        pallet: '0.00',
        tare: [
          { units: 48, unitWeightKg: '1.20' },
          { units: 8, unitWeightKg: null },
        ],
        tareKg: '60.00',
        net: '240.60',
      })),
    ).toBe('300.60 kg − 60.00 kg tare = 240.60 kg');
  });

  it('says nothing when nothing is subtracted', () => {
    expect(
      netFormula(t, 'en', { gross: '50.00', pallet: '0.00', tare: [], tareKg: '0.00', net: '50.00' }),
    ).toBeNull();
  });
});

describe('netParts — what the traced formula renders', () => {
  it('names the pallet and one term per tare type, or the stored total, or nothing', () => {
    const line = { gross: '300.60', pallet: '15.60', tareKg: '57.60', net: '227.40' };
    expect(netParts({ ...line, tare: [{ units: 48, unitWeightKg: '1.20' }] })).toEqual({
      pallet: '15.60',
      tare: { kind: 'units', terms: [{ units: 48, weightKg: '1.20' }] },
    });
    expect(netParts({ ...line, pallet: '0.00', tare: [{ units: 48, unitWeightKg: null }] })).toEqual({
      pallet: null,
      tare: { kind: 'kg', kg: '57.60' },
    });
    expect(netParts({ ...line, pallet: '0.00', tareKg: '0.00', tare: [] })).toBeNull();
  });
});
