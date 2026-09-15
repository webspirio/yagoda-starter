import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CrateIssuance } from './crate-issuance.entity';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { CreateCrateIssuanceDto } from './dto/create-crate-issuance.dto';
import { CrateIssuanceResponse, toCrateIssuanceResponse } from './crate-issuance.mapper';
import { nextIssuanceCode } from './crate-code';
import { ShiftsService } from '../shifts/shifts.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import { TareTypesService } from '../tare-types/tare-types.service';
import { AuditService } from '../audit/audit.service';
import { mul } from '../common/money';
import { resolveWritePoint } from '../auth/access/point-scope';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Injectable()
export class CratesService {
  constructor(
    @InjectRepository(CrateIssuance)
    private readonly issuances: Repository<CrateIssuance>,
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
    private readonly suppliers: SuppliersService,
    private readonly points: CollectionPointsService,
    private readonly tareTypes: TareTypesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * §6.3 and §6.4 in one method — the two modes differ ONLY in money, and the
   * difference is three lines below, not two code paths.
   *
   * NO THRESHOLD CHECK. §6.2's «до 50 завдаток, від 51 розписка» is the
   * client's default selection; ticket #60 is explicit that the choice is not
   * restricted («ми не обмежуємо вибір»), and a server-side rule here would be
   * the blocking validation the client refused.
   *
   * NO `target_crates` CHECK EITHER. Правка 14: an unset target WARNS and never
   * blocks an issuance — «забороняти видачу через порожній target_crates
   * означало б відтворити скасовану заборону».
   */
  async issue(
    actor: AuthenticatedUser,
    dto: CreateCrateIssuanceDto,
  ): Promise<CrateIssuanceResponse> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);

    const point = await this.points.findOneRaw(pointId);
    if (!point) throw new NotFoundException('Collection point not found');

    const supplier = await this.suppliers.findOne(actor, dto.supplier_id);
    // 404, not 403 — these rows carry a real person's name.
    if (supplier.collection_point_id !== pointId) {
      throw new NotFoundException('Supplier not found');
    }
    if (!supplier.is_active) {
      throw new BadRequestException({
        message: 'That supplier is deactivated',
        code: 'SUPPLIER_INACTIVE',
      });
    }

    return this.dataSource.transaction(async (m) => {
      const shift = await this.shifts.findOpenAtPoint(pointId, m);
      if (!shift) {
        throw new ConflictException({
          message: 'No open shift at this point — open one first',
          code: 'NO_OPEN_SHIFT',
        });
      }

      // A receipt issuance never reads the catalogue price, but it DOES require
      // a crate type to exist: without one, «ящик» has no definition at this
      // network at all, and the units about to be recorded would mean nothing.
      const crateType = await this.tareTypes.findCrateType(m);
      if (!crateType) {
        throw new ConflictException({
          message: 'No crate type is configured — mark one tare type as the crate first',
          code: 'NO_CRATE_TYPE',
        });
      }

      // §2.7 — the SNAPSHOT. Repricing the catalogue never touches this row.
      const perUnit =
        dto.mode === CrateIssuanceMode.Receipt ? '0.00' : crateType.deposit_price;
      const taken =
        dto.mode === CrateIssuanceMode.Receipt ? '0.00' : mul(perUnit, String(dto.units));

      const code = await nextIssuanceCode(m, {
        pointCode: point.code,
        businessDate: shift.business_date,
        shiftId: shift.id,
        mode: dto.mode,
      });

      const issuance = await m.save(
        CrateIssuance,
        m.create(CrateIssuance, {
          code,
          shift_id: shift.id,
          supplier_id: supplier.id,
          units: dto.units,
          mode: dto.mode,
          deposit_per_unit: perUnit,
          deposit_taken: taken,
          issued_by_user_id: actor.sub,
        }),
      );

      await this.audit.record(
        {
          action: 'crate-issuance.created',
          actor_id: actor.sub,
          target_type: 'crate_issuance',
          target_id: issuance.id,
          after: {
            code,
            units: dto.units,
            mode: dto.mode,
            deposit_taken: taken,
            supplier_id: supplier.id,
          },
        },
        m,
      );

      return toCrateIssuanceResponse(issuance, shift);
    });
  }
}
