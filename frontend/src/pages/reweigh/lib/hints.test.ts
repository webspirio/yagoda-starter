import { describe, it, expect } from 'vitest';
import { addBlockReason, grossHint, tareHint, GROSS_SUSPECT_KG, TARE_SUSPECT_UNITS } from './hints';

const ok = {
  hasShift: true, acceptedAnything: true,
  gradeId: 'g1', grossKg: '120.00', netKg: '100.00',
};

describe('addBlockReason', () => {
  it('lets a complete line through', () => {
    expect(addBlockReason(ok)).toBeNull();
  });

  it('names the missing shift FIRST — it precedes every other question', () => {
    expect(
      addBlockReason({ ...ok, hasShift: false, acceptedAnything: false, gradeId: null, grossKg: '0.00' }),
    ).toBe('noShift');
  });

  it('names an empty day before a missing grade', () => {
    expect(addBlockReason({ ...ok, acceptedAnything: false, gradeId: null })).toBe('nothingAccepted');
  });

  it('asks for a grade before a weight', () => {
    expect(addBlockReason({ ...ok, gradeId: null, grossKg: '0.00' })).toBe('noGrade');
  });

  it('asks for the gross weight before judging the net', () => {
    expect(addBlockReason({ ...ok, grossKg: '0.00', netKg: '-5.00' })).toBe('noGross');
  });

  it('refuses a line the pallet and tare eat entirely', () => {
    expect(addBlockReason({ ...ok, netKg: '0.00' })).toBe('noNet');
    expect(addBlockReason({ ...ok, netKg: '-0.01' })).toBe('noNet');
  });
});

describe('grossHint', () => {
  it('warns above the season record, not at it', () => {
    expect(grossHint(`${GROSS_SUSPECT_KG}.00`)).toBe(false);
    expect(grossHint(`${GROSS_SUSPECT_KG}.01`)).toBe(true);
    expect(grossHint('701.50')).toBe(false);
  });
});

describe('tareHint', () => {
  it('warns above the season record, not at it', () => {
    expect(tareHint(TARE_SUSPECT_UNITS, '500.00')).toBeNull();
    expect(tareHint(TARE_SUSPECT_UNITS + 1, '500.00')).toBe('tooMany');
  });

  it('warns that berry weight would go into the net when no tare is entered', () => {
    expect(tareHint(0, '500.00')).toBe('none');
  });

  it('says nothing about missing tare before there is a weight to misattribute', () => {
    expect(tareHint(0, '0.00')).toBeNull();
  });
});
