import { NotFoundException } from '@nestjs/common';
import {
  makeIntakesMocks,
  buildIntakes,
  type IntakesMocks,
  oksana,
  owner,
  dto,
  POINT_A,
  POINT_B,
  SUPPLIER,
  GRADE,
  CRATE,
} from '../../testing/unit/intakes.mocks';
import { PreviewIntakeQuery } from './preview-intake.query';

/**
 * `POST /intakes/preview` — `create` up to the point where it would write,
 * and then nothing. The reception screen shows net weight, price, bonus and
 * the line and document amounts LIVE as the operator types, and §2.4/§2.8/
 * §2.9 make the server the only place those may be computed — so the client
 * asks for the numbers without asking for a document.
 */
describe('PreviewIntakeQuery', () => {
  let manager: IntakesMocks['manager'];
  let plainManager: IntakesMocks['plainManager'];
  let dataSource: IntakesMocks['dataSource'];
  let shifts: IntakesMocks['shifts'];
  let suppliers: IntakesMocks['suppliers'];
  let prices: IntakesMocks['prices'];
  let tare: IntakesMocks['tare'];
  let points: IntakesMocks['points'];
  let audit: IntakesMocks['audit'];
  let query: PreviewIntakeQuery;

  beforeEach(() => {
    const mocks = makeIntakesMocks();
    ({ manager, plainManager, dataSource, shifts, suppliers, prices, tare, points, audit } = mocks);
    query = buildIntakes(mocks).preview;
  });

  describe('preview', () => {
    const previewDto = (over: Record<string, unknown> = {}) => ({
      supplier_id: SUPPLIER,
      items: dto().items,
      ...over,
    });

    it('computes exactly what create would store — lines, total, point, supplier, business date', async () => {
      const result = await query.preview(oksana, previewDto());

      expect(result).toEqual({
        collection_point_id: POINT_A,
        supplier_id: SUPPLIER,
        business_date: '2026-09-08',
        amount: '2103.30',
        items: [
          {
            item_order: 1,
            product_grade_id: GRADE,
            gross_kg: '42.00',
            pallet_kg: '1.50',
            tare_weight_kg: '3.60',
            net_kg: '36.90',
            price: '57.00',
            bonus: '0.00',
            amount: '2103.30',
            tare: [{ tare_type_id: CRATE, units: 3 }],
          },
        ],
      });
    });

    it('writes NOTHING — no transaction, no save, no audit, no code', async () => {
      const result = await query.preview(oksana, previewDto());

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('code');
      expect(result.items[0]).not.toHaveProperty('id');
    });

    it('takes the SAME snapshots create takes, through the plain manager', async () => {
      // Same reads, same order, so the preview and the document that follows
      // it can only disagree if a price or tare row changed in between.
      await query.preview(oksana, previewDto());

      expect(shifts.findOpenAtPoint).toHaveBeenCalledWith(POINT_A, plainManager);
      expect(prices.currentFor).toHaveBeenCalledWith(POINT_A, GRADE, plainManager);
      expect(tare.findManyRaw).toHaveBeenCalledWith([CRATE], plainManager);
    });

    it('409s when no shift is open — the form is unusable outside one, and the operator learns it early', async () => {
      shifts.findOpenAtPoint.mockResolvedValue(null);

      await expect(query.preview(oksana, previewDto())).rejects.toMatchObject({
        response: { code: 'NO_OPEN_SHIFT' },
      });
    });

    it('refuses the same supplier create refuses: inactive, or at another point', async () => {
      suppliers.findOne.mockResolvedValueOnce({
        id: SUPPLIER,
        collection_point_id: POINT_A,
        is_active: false,
      });
      await expect(query.preview(oksana, previewDto())).rejects.toMatchObject({
        response: { code: 'SUPPLIER_INACTIVE' },
      });

      suppliers.findOne.mockResolvedValueOnce({
        id: SUPPLIER,
        collection_point_id: POINT_B,
        is_active: true,
      });
      await expect(query.preview(oksana, previewDto())).rejects.toThrow(NotFoundException);
    });

    it('400s a grade with no current price at this point (§4.5)', async () => {
      prices.currentFor.mockResolvedValue(null);

      await expect(query.preview(oksana, previewDto())).rejects.toMatchObject({
        response: { code: 'GRADE_NOT_PRICED' },
      });
    });

    it('400s a tare type it cannot snapshot — unknown or deactivated', async () => {
      tare.findManyRaw.mockResolvedValue([]);

      await expect(query.preview(oksana, previewDto())).rejects.toMatchObject({
        response: { code: 'TARE_TYPE_UNKNOWN' },
      });
    });

    it('resolves the point the way create does: token for an operator, body for the owner', async () => {
      await expect(query.preview(owner, previewDto())).rejects.toMatchObject({
        response: { code: 'COLLECTION_POINT_REQUIRED' },
      });

      const result = await query.preview(owner, previewDto({ collection_point_id: POINT_A }));
      expect(result.collection_point_id).toBe(POINT_A);

      points.findOneRaw.mockResolvedValue(null);
      await expect(
        query.preview(owner, previewDto({ collection_point_id: POINT_B })),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
