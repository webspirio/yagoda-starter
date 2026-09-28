import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  buildIntake,
  type BuiltIntake,
  type PriceSnapshot,
  type TareSnapshot,
} from '../intake-lines';
import { PreviewIntakeDto } from '../dto/preview-intake.dto';
import { Shift } from '../../shifts/shift.entity';
import { ShiftsService } from '../../shifts/shifts.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import type { SupplierResponse } from '../../suppliers/supplier.mapper';
import { GradePricesService } from '../../grade-prices/grade-prices.service';
import { TareTypesService } from '../../tare-types/tare-types.service';
import { CollectionPointsService } from '../../collection-points/collection-points.service';
import type { CollectionPoint } from '../../collection-points/collection-point.entity';
import { resolveWritePoint } from '../../auth/access/point-scope';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * The reads a receipt is computed from, shared by create and preview so the two are the SAME
 * reads in the SAME order: a preview can then disagree with the document that follows only if
 * a price or tare row changed in between — and then the document is right to win.
 */
@Injectable()
export class PriceIntakeQuery {
  constructor(
    private readonly points: CollectionPointsService,
    private readonly suppliers: SuppliersService,
    private readonly shifts: ShiftsService,
    private readonly prices: GradePricesService,
    private readonly tare: TareTypesService,
  ) {}

  /** Where the document lands and who it is for. Outside any transaction on purpose: the common
   *  failure returns without opening one, and a supplier deactivated a moment later is a
   *  document written a second early, not a corrupt one. */
  async target(
    actor: AuthenticatedUser,
    dto: PreviewIntakeDto,
  ): Promise<{ pointId: string; point: CollectionPoint; supplier: SupplierResponse }> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);

    // Loaded for its `code` (the receipt's first segment); a bad body-supplied point would
    // otherwise reach the FK as a 500.
    const point = await this.points.findOneRaw(pointId);
    if (!point) throw new NotFoundException('Collection point not found');

    // `findOne` enforces visibility, so another point's supplier is a 404.
    const supplier = await this.suppliers.findOne(actor, dto.supplier_id);
    if (supplier.collection_point_id !== pointId) {
      throw new NotFoundException('Supplier not found');
    }
    if (!supplier.is_active) {
      throw new BadRequestException({
        message: 'That supplier is deactivated',
        code: 'SUPPLIER_INACTIVE',
      });
    }
    return { pointId, point, supplier };
  }

  /** Open shift, then the two snapshots, then every rule in one pure call. Create runs it inside
   *  its transaction so the stored price is the one current at the insert. */
  async price(
    pointId: string,
    dto: PreviewIntakeDto,
    m: EntityManager,
  ): Promise<{ shift: Shift; built: BuiltIntake }> {
    const shift = await this.shifts.findOpenAtPoint(pointId, m);
    if (!shift) {
      throw new ConflictException({
        message: 'No open shift at this point — open one first',
        code: 'NO_OPEN_SHIFT',
      });
    }
    const prices = await this.snapshotPrices(pointId, dto, m);
    const tareTypes = await this.snapshotTare(dto, m);
    return { shift, built: buildIntake(dto.items, prices, tareTypes) };
  }

  /** §2.8 — a snapshot of the row current now; §4.5 makes a missing one `buildIntake`'s refusal. */
  private async snapshotPrices(
    pointId: string,
    dto: PreviewIntakeDto,
    m: EntityManager,
  ): Promise<Map<string, PriceSnapshot>> {
    const gradeIds = [...new Set(dto.items.map((i) => i.product_grade_id))];
    const rows = await Promise.all(gradeIds.map((g) => this.prices.currentFor(pointId, g, m)));
    const prices = new Map<string, PriceSnapshot>();
    rows.forEach((row) => {
      if (row) {
        prices.set(row.product_grade_id, {
          base_price: row.base_price,
          max_markup: row.max_markup,
          max_discount: row.max_discount,
        });
      }
    });
    return prices;
  }

  /** §2.5 — «вага тари підставляється сама». */
  private async snapshotTare(
    dto: PreviewIntakeDto,
    m: EntityManager,
  ): Promise<Map<string, TareSnapshot>> {
    const tareIds = [...new Set(dto.items.flatMap((i) => i.tare.map((t) => t.tare_type_id)))];
    const rows = await this.tare.findManyRaw(tareIds, m);
    return new Map(rows.map((t) => [t.id, { id: t.id, weight_kg: t.weight_kg }]));
  }
}
