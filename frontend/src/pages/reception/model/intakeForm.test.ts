import { describe, it, expect } from 'vitest';
import { emptyLine, toPreviewBody, type IntakeFormValues } from './intakeForm';

function withTare(...units: string[]): IntakeFormValues {
  return {
    supplier_id: 's1',
    items: [{ ...emptyLine('t1'), tare: units.map((u) => ({ tare_type_id: 't1', units: u })) }],
    paid_amount: '',
    returned_crates: '',
  };
}

describe('toPreviewBody — tare counts (#72 / #233 review)', () => {
  it('sends a whole count as a number', () => {
    expect(toPreviewBody(withTare('12', '2.0'), null).items[0].tare.map((r) => r.units)).toEqual([
      12, 2,
    ]);
  });

  it('never reads «2.5» as 2 — a count that is not whole is SENT, for the server to refuse', () => {
    const units = toPreviewBody(withTare('2.5'), null).items[0].tare.map((r) => r.units);
    expect(units).toHaveLength(1);
    expect(units[0]).toBe(2.5);
  });

  it('drops only an untouched row: empty, or a whole count below 1', () => {
    expect(toPreviewBody(withTare('', '0', '3'), null).items[0].tare.map((r) => r.units)).toEqual([
      3,
    ]);
  });
});
