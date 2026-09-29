import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PreviewIntakeDto } from '../dto/preview-intake.dto';
import { PreviewIntakeResponse, toPreviewIntakeResponse } from '../intake.mapper';
import { PriceIntakeQuery } from './price-intake.query';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * Create up to the write, then nothing — the reception screen's live numbers, computed only
 * here (§2.4/§2.8/§2.9), with the same refusals so the operator learns early. NOT a
 * transaction on purpose: nothing is saved, audited or numbered.
 */
@Injectable()
export class PreviewIntakeQuery {
  constructor(
    private readonly dataSource: DataSource,
    private readonly pricing: PriceIntakeQuery,
  ) {}

  async preview(actor: AuthenticatedUser, dto: PreviewIntakeDto): Promise<PreviewIntakeResponse> {
    const { pointId, supplier } = await this.pricing.target(actor, dto);
    const { shift, built } = await this.pricing.price(pointId, dto, this.dataSource.manager);
    return toPreviewIntakeResponse(
      {
        collection_point_id: pointId,
        supplier_id: supplier.id,
        business_date: shift.business_date,
      },
      built,
    );
  }
}
