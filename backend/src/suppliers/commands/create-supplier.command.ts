import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Supplier } from '../supplier.entity';
import { SupplierKind } from '../supplier-kind.enum';
import { canonicalizePhone } from '../phone';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { SupplierResponse, toSupplierResponse } from '../supplier.mapper';
import { assertPhoneFree } from '../supplier-access';
import { resolveWritePoint } from '../../auth/access/point-scope';
import { AuditService } from '../../audit/audit.service';
import { CollectionPointsService } from '../../collection-points/collection-points.service';
import { assertTrimmedName } from '../../common/trimmed-name';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class CreateSupplierCommand {
  constructor(
    @InjectRepository(Supplier)
    private readonly repo: Repository<Supplier>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly points: CollectionPointsService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateSupplierDto): Promise<SupplierResponse> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);
    // A BODY-SUPPLIED point is unvalidated until this line. `assertOwnsPoint`
    // is a pure id comparison that returns on its first line for an owner, so
    // without this a well-formed but nonexistent uuid reaches
    // `FK_suppliers_point` and the caller gets a 500 — there is no
    // `QueryFailedError` mapping anywhere in the backend. Same check, same
    // 404, as `GradePricesService.create`. An operator's own point comes from
    // their token and is guaranteed by the users FK, so it is not re-read.
    if (dto.collection_point_id) {
      const point = await this.points.findOneRaw(pointId);
      if (!point) throw new NotFoundException('Collection point not found');
    }
    const first_name = assertTrimmedName(dto.first_name, 'first_name', 'SUPPLIER_NAME_EMPTY');
    const last_name = assertTrimmedName(dto.last_name, 'last_name', 'SUPPLIER_NAME_EMPTY');
    const phone = dto.phone == null ? null : canonicalizePhone(dto.phone);
    if (phone) await assertPhoneFree(this.repo, pointId, phone);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Supplier);
      const supplier = await repo.save(
        repo.create({
          collection_point_id: pointId,
          first_name,
          last_name,
          phone,
          note: dto.note ?? null,
          kind: dto.kind ?? SupplierKind.None,
        }),
      );

      await this.audit.record(
        {
          action: 'supplier.created',
          actor_id: actor.sub,
          target_type: 'supplier',
          target_id: supplier.id,
          after: {
            collection_point_id: supplier.collection_point_id,
            first_name: supplier.first_name,
            last_name: supplier.last_name,
            phone: supplier.phone,
            kind: supplier.kind,
          },
        },
        manager,
      );

      return toSupplierResponse(supplier);
    });
  }
}
