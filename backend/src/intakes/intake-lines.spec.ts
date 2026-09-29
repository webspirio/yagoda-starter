import { BadRequestException } from '@nestjs/common';
import { buildIntake, type PriceSnapshot, type TareSnapshot } from './intake-lines';

const GRADE = 'grade-1';
const CRATE = 'tare-crate';
const BUCKET = 'tare-bucket';

const prices = (over: Partial<PriceSnapshot> = {}): Map<string, PriceSnapshot> =>
  new Map([[GRADE, { base_price: '57.00', max_markup: '30.00', max_discount: '20.00', ...over }]]);

const tare = (): Map<string, TareSnapshot> =>
  new Map([
    [CRATE, { id: CRATE, weight_kg: '1.20', is_crate: true }],
    [BUCKET, { id: BUCKET, weight_kg: '0.50', is_crate: false }],
  ]);

const line = (over: Record<string, unknown> = {}) => ({
  product_grade_id: GRADE,
  gross_kg: '42.00',
  pallet_kg: '1.50',
  bonus: '0.00',
  tare: [{ tare_type_id: CRATE, units: 3 }],
  ...over,
});

describe('buildIntake', () => {
  describe('§2.4 — pallet FIRST, tare second', () => {
    it('computes net as (gross − pallet) − tare', () => {
      const built = buildIntake([line()], prices(), tare());

      expect(built.items[0].tare_weight_kg).toBe('3.60'); // 3 × 1.20
      expect(built.items[0].net_kg).toBe('36.90'); // (42.00 − 1.50) − 3.60
    });

    it('reproduces the client’s own worked row', () => {
      // §2.4, straight from the working book: 552,30 − 14,30 піддон − 100 ящиків
      // × 1,20 = 418,00 кг × 65 ₴ = 27 170,00 ₴. The stated cost of getting the
      // ORDER wrong on this row is «929,50 ₴, віддані за повітря».
      const built = buildIntake(
        [
          line({
            gross_kg: '552.30',
            pallet_kg: '14.30',
            tare: [{ tare_type_id: CRATE, units: 100 }],
          }),
        ],
        prices({ base_price: '65.00' }),
        tare(),
      );

      expect(built.items[0].net_kg).toBe('418.00');
      expect(built.items[0].amount).toBe('27170.00');
    });

    it('refuses a pallet heavier than the gross', () => {
      expect(() =>
        buildIntake([line({ gross_kg: '1.00', pallet_kg: '2.00' })], prices(), tare()),
      ).toThrow(BadRequestException);
    });
  });

  describe('§2.5 — tare weight is substituted, never typed', () => {
    it('sums units × weight across several tare types on one line', () => {
      const built = buildIntake(
        [
          line({
            tare: [
              { tare_type_id: CRATE, units: 3 },
              { tare_type_id: BUCKET, units: 2 },
            ],
          }),
        ],
        prices(),
        tare(),
      );

      expect(built.items[0].tare_weight_kg).toBe('4.60'); // 3×1.20 + 2×0.50
    });

    /**
     * REVERSED after `26-rules-by-example.md` arrived in the repository. An
     * earlier draft asserted that an empty tare list is ACCEPTED. §9.1 lists
     * «позиція без тари» under «Заборонено — система не дає провести взагалі»,
     * and §9.2 prices the mistake: 115 crates × 1,20 кг = 138 кг × 145 ₴ =
     * 20 010,00 ₴ handed over for air, «завжди на користь здавальника».
     *
     * THE SOURCE CONTRADICTS ITSELF: §9.2 lists the same case as a WARNING.
     * Spec §10.2 records the conflict and why the strict reading was taken.
     */
    it('refuses a line with no tare at all', () => {
      expect(() => buildIntake([line({ tare: [] })], prices(), tare())).toThrow(/tare/i);
    });

    /**
     * §6.3 — «a `tare_type_id` may appear at most once per item — that is the
     * composite primary key `(item_id, tare_type_id)`, so a repeated type is a
     * 400 BEFORE it is a 23505». Without this the units are summed twice into
     * `tare_weight_kg` and the cascade insert dies on
     * `PK_intake_item_tare_types`, which no `QueryFailedError` mapping catches
     * — the operator with a car waiting gets an opaque 500 for typing two rows
     * of «Чешка» instead of one row with `units: 8`.
     */
    it('refuses the same tare type twice on one line', () => {
      expect(() =>
        buildIntake(
          [
            line({
              tare: [
                { tare_type_id: CRATE, units: 3 },
                { tare_type_id: CRATE, units: 5 },
              ],
            }),
          ],
          prices(),
          tare(),
        ),
      ).toThrow(/once/i);
    });

    it('names the repeated type with a stable code', () => {
      try {
        buildIntake(
          [
            line({
              tare: [
                { tare_type_id: BUCKET, units: 1 },
                { tare_type_id: BUCKET, units: 1 },
              ],
            }),
          ],
          prices(),
          tare(),
        );
        throw new Error('expected a BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
          code: 'TARE_TYPE_DUPLICATED',
        });
      }
    });

    it('rejects an unknown tare type rather than silently weighing nothing', () => {
      expect(() =>
        buildIntake([line({ tare: [{ tare_type_id: 'ghost', units: 1 }] })], prices(), tare()),
      ).toThrow(/tare/i);
    });
  });

  describe('§2.8 — price snapshot and the per-line bonus', () => {
    it('uses the snapshotted base price and adds the bonus to the RATE', () => {
      const built = buildIntake([line({ bonus: '3.00' })], prices(), tare());

      expect(built.items[0].price).toBe('57.00'); // snapshot, unchanged
      expect(built.items[0].bonus).toBe('3.00');
      expect(built.items[0].amount).toBe('2214.00'); // 36.90 × 60.00
    });

    it('accepts a negative bonus — «м’ята чи цвіла ягода»', () => {
      const built = buildIntake([line({ bonus: '-5.00' })], prices(), tare());

      expect(built.items[0].amount).toBe('1918.80'); // 36.90 × 52.00
    });

    it('carries a DIFFERENT bonus on each line of one document', () => {
      // §2.8 — «надбавка живе ОКРЕМО, у bonus НА РЯДКУ, а не на людині: одна
      // людина може здати два сорти з різними надбавками».
      const built = buildIntake(
        [line({ bonus: '3.00' }), line({ bonus: '-2.00' })],
        prices(),
        tare(),
      );

      expect(built.items[0].bonus).toBe('3.00');
      expect(built.items[1].bonus).toBe('-2.00');
    });

    it('throws when the grade has no price row at this point (§4.5)', () => {
      expect(() => buildIntake([line()], new Map(), tare())).toThrow(/price/i);
    });
  });

  describe('§2.9 — the clamp the prices slice built columns for', () => {
    it.each([
      ['30.00', true],
      ['30.01', false],
      ['-20.00', true],
      ['-20.01', false],
    ])('bonus %s is accepted: %s', (bonus, ok) => {
      const run = () => buildIntake([line({ bonus })], prices(), tare());

      if (ok) expect(run).not.toThrow();
      else expect(run).toThrow(/bonus/i);
    });

    /**
     * THE MESSAGE MUST CARRY THE NUMBER. §2.10 («межа працює як обмеження, а не
     * як підказка») reads like a rule that the limit must never be shown, and
     * an earlier draft of the spec treated it as one. It is a UI/UX
     * recommendation about the RESTING STATE of the screen — the limit is not
     * secret, the owner sees it, and it is surfaced precisely when someone
     * exceeds it (owner's clarification, 2026-09-08). A 400 the operator cannot
     * act on is the worse outcome.
     */
    it('names the permitted range in the message', () => {
      expect(() => buildIntake([line({ bonus: '35.00' })], prices(), tare())).toThrow(
        /-20\.00.*30\.00|30\.00.*-20\.00/,
      );
    });

    /**
     * The clamp alone does NOT close this. `max_discount` is an independent
     * magnitude, so a cheap grade admits a legal bonus that drives the effective
     * rate below zero — and a negative rate on a positive weight is a document
     * that TAKES money from the supplier for delivering berries.
     */
    it('refuses a legal bonus that still makes price + bonus negative', () => {
      const cheap = prices({ base_price: '10.00' });

      // Asserted on the CODE, not the message: the wording is for the operator
      // and should be free to improve, while `RATE_NEGATIVE` is the contract.
      // (The bonus-range test above is the deliberate exception — there the
      // message text IS the rule being tested, per §2.10.)
      expect(() => buildIntake([line({ bonus: '-15.00' })], cheap, tare())).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: 'RATE_NEGATIVE' }) }),
      );
    });
  });

  describe('§2.3 — the document total', () => {
    it('is Σ of the ROUNDED line amounts, in line order', () => {
      const built = buildIntake([line(), line({ bonus: '3.00' })], prices(), tare());

      expect(built.items.map((i) => i.item_order)).toEqual([1, 2]);
      expect(built.amount).toBe('4317.30'); // 2103.30 + 2214.00
    });

    it('produces Σ round(each), not round(Σ)', () => {
      // Three lines each landing exactly on a half-kopiyka. Rounding once at
      // the end gives a DIFFERENT number from the one printed on the paper.
      const halves = prices({ base_price: '0.05', max_markup: '0.00', max_discount: '0.00' });
      const tiny = () =>
        line({
          gross_kg: '1.30',
          pallet_kg: '0.00',
          bonus: '0.00',
          tare: [{ tare_type_id: CRATE, units: 1 }],
        });

      const built = buildIntake([tiny(), tiny(), tiny()], halves, tare());

      expect(built.items[0].net_kg).toBe('0.10'); // 1.30 − 1.20
      expect(built.items.map((i) => i.amount)).toEqual(['0.01', '0.01', '0.01']);
      expect(built.amount).toBe('0.03'); // round(0.0150) would be 0.02
    });
  });

  describe('net weight', () => {
    it('refuses a net of exactly zero', () => {
      // §9.1 — «Чиста вага виходить нульова: піддон і тара з'їдають усе брутто»
      // → «Прийняти» НЕАКТИВНА.
      expect(() =>
        buildIntake([line({ gross_kg: '3.60', pallet_kg: '0.00' })], prices(), tare()),
      ).toThrow(/net/i);
    });
  });

  describe('crate_units — spec §8.3, the ceiling on crates returned with a receipt', () => {
    it('sums the crate-tare units across every line, and only those', () => {
      const built = buildIntake(
        [
          line({ tare: [{ tare_type_id: CRATE, units: 3 }] }),
          line({
            tare: [
              { tare_type_id: CRATE, units: 2 },
              { tare_type_id: BUCKET, units: 5 },
            ],
          }),
        ],
        prices(),
        tare(),
      );

      expect(built.crate_units).toBe(5);
    });

    it('is 0 when no line carries the crate', () => {
      const built = buildIntake(
        [line({ tare: [{ tare_type_id: BUCKET, units: 5 }] })],
        prices(),
        tare(),
      );

      expect(built.crate_units).toBe(0);
    });
  });
});
