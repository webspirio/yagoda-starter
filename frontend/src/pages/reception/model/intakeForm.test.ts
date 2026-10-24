import { describe, it, expect } from 'vitest';
import {
  emptyLine,
  hasTare,
  toPreviewBody,
  withoutBlankDraft,
  type IntakeFormValues,
} from './intakeForm';

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
    expect(toPreviewBody(withTare('12', ' 3 '), null).items[0].tare.map((r) => r.units)).toEqual([
      12, 3,
    ]);
  });

  it('drops only an untouched row: empty or 0', () => {
    expect(toPreviewBody(withTare('', '0', '3'), null).items[0].tare.map((r) => r.units)).toEqual([
      3,
    ]);
  });

  it('never sends a count that is not whole — the form refuses it before any request', () => {
    const units = toPreviewBody(withTare('2.5', '1.2.3', '4'), null).items[0].tare.map(
      (r) => r.units,
    );
    expect(units).toEqual([4]);
  });
});

describe('withoutBlankDraft — the fresh draft «Ще позиція» leaves behind (client, 24.10)', () => {
  const filled = { ...emptyLine('t1'), product_grade_id: 'g1', gross_kg: '20.00' };
  const form = (...items: IntakeFormValues['items']): IntakeFormValues => ({
    supplier_id: 's1',
    items,
    paid_amount: '',
    returned_crates: '',
  });

  it('drops an untouched trailing draft behind a committed line', () => {
    expect(withoutBlankDraft(form(filled, emptyLine('t1'))).items).toEqual([filled]);
  });

  it('keeps a draft the operator has started — a weight, a grade or a pallet', () => {
    for (const started of [
      { ...emptyLine('t1'), gross_kg: '10' },
      { ...emptyLine('t1'), product_grade_id: 'g2' },
      { ...emptyLine('t1'), pallet_kg: '14.30' },
    ]) {
      expect(withoutBlankDraft(form(filled, started)).items).toHaveLength(2);
    }
  });

  it('never drops the only line, so an empty form still reads as empty', () => {
    expect(withoutBlankDraft(form(emptyLine('t1'))).items).toHaveLength(1);
  });
});

describe('hasTare — a line is never sent with no tare (§9.1)', () => {
  const line = (...units: string[]) => withTare(...units).items[0];

  it('refuses a fresh line: its one row starts at 0', () => {
    expect(emptyLine('t1').tare).toEqual([{ tare_type_id: 't1', units: '0' }]);
    expect(hasTare(emptyLine('t1'))).toBe(false);
  });

  it('refuses rows that all count 0 or nothing', () => {
    expect(hasTare(line('0', '', '00'))).toBe(false);
  });

  it('accepts a line once any row counts at least one', () => {
    expect(hasTare(line('0', '3'))).toBe(true);
  });

  it('refuses a count the form refuses, even beside a good one', () => {
    expect(hasTare(line('2,0', '3'))).toBe(false);
  });
});
