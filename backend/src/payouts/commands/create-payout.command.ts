import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreatePayoutDto } from '../dto/create-payout.dto';
import { PayoutResponse, toPayoutResponse } from '../payout.mapper';
import { PayoutWriter } from '../services/payout-writer';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { CollectionPointsService } from '../../collection-points/collection-points.service';
import { AllocationsService } from '../../supplier-balance/services/allocations';
import { isZero } from '../../common/money';
import { resolveWritePoint } from '../../auth/access/point-scope';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/** «Видати без ягоди» — a payout not tied to a receipt. */
@Injectable()
export class CreatePayoutCommand {
  constructor(
    private readonly dataSource: DataSource,
    private readonly points: CollectionPointsService,
    private readonly suppliers: SuppliersService,
    private readonly allocations: AllocationsService,
    private readonly writer: PayoutWriter,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreatePayoutDto): Promise<PayoutResponse> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);

    // Spec §8.6: a zero payout is a receipt for nothing. `CHK_payouts_amount` is the real
    // guarantee; this makes the refusal a 400 with a sentence instead of a 500.
    if (isZero(dto.amount)) {
      throw new BadRequestException({
        message: 'A payout must hand over some money',
        code: 'PAYOUT_AMOUNT_ZERO',
      });
    }

    const point = await this.points.findOneRaw(pointId);
    if (!point) throw new NotFoundException('Collection point not found');

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

    return this.dataSource.transaction((m) =>
      this.allocations.withinSupplierLedger(m, supplier.id, async () => {
        const { payout, shift } = await this.writer.write(m, {
          actor,
          pointId,
          pointCode: point.code,
          supplierId: supplier.id,
          amount: dto.amount,
          intakeId: null,
        });
        return toPayoutResponse(payout, shift);
      }),
    );
  }
}
