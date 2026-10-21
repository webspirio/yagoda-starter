import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Supplier } from '../supplier.entity';
import { canonicalizePhone } from '../phone';
import { UpdateSupplierDto } from '../dto/update-supplier.dto';
import { SupplierResponse, toSupplierResponse } from '../supplier.mapper';
import { assertPhoneFree } from '../supplier-access';
import { AuditService } from '../../audit/audit.service';
import { assertOwnsPoint } from '../../auth/access/point-scope';
import { assertTrimmedName } from '../../common/trimmed-name';
import { diffFields } from '../../common/diff-fields';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

const SUPPLIER_FIELDS = ['first_name', 'last_name', 'phone', 'note', 'kind', 'is_active'] as const;

function snapshot(s: Supplier): Record<(typeof SUPPLIER_FIELDS)[number], unknown> {
  return {
    first_name: s.first_name,
    last_name: s.last_name,
    phone: s.phone,
    note: s.note,
    kind: s.kind,
    is_active: s.is_active,
  };
}

@Injectable()
export class UpdateSupplierCommand {
  constructor(
    @InjectRepository(Supplier)
    private readonly repo: Repository<Supplier>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /**
   * TODO (when `intakes` and `payouts` land): decide whether deactivating a
   * supplier carrying non-zero debt deserves a WARNING. Never a refusal —
   * §6.1 and правка 14, «заблокована кнопка вчить шукати обхід». And "settle
   * up first" is not even well-defined: the `suppliers` Note establishes that
   * debt can legitimately be NEGATIVE after a voided receipt, and that
   * «інваріанта борг >= 0 в цій схемі теж немає».
   *
   * 403 HERE, 404 IN `findOne` — deliberately, not an oversight in either.
   * §7's table mandates `assertOwnsPoint` on PATCH, while §8.3 argues the read
   * must not confirm a row exists at another point. A write already needs the
   * id AND a payload, so the oracle it offers is the weaker of the two. Do not
   * «fix» one to match the other without reading both sections.
   *
   * A RENAME REASSIGNS A MONEY BALANCE, and no guard here prevents it. Debt
   * follows `supplier_id`, not the name, so editing «Іван Коваль» into «Петро
   * Мельник» moves a real balance to a different human — with no delete and,
   * per §5.5 as cancelled by правка 6, NO merge tool, ever. The audit
   * before/after diff is the only trail. A guard was considered and rejected:
   * every version of it also blocks the common case, which is fixing a typo in
   * a name entered at 06:40.
   */
  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateSupplierDto,
  ): Promise<SupplierResponse> {
    const supplier = await this.repo.findOne({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    assertOwnsPoint(actor, supplier.collection_point_id);

    const before = snapshot(supplier);

    if (dto.first_name != null) {
      supplier.first_name = assertTrimmedName(dto.first_name, 'first_name', 'SUPPLIER_NAME_EMPTY');
    }
    if (dto.last_name != null) {
      supplier.last_name = assertTrimmedName(dto.last_name, 'last_name', 'SUPPLIER_NAME_EMPTY');
    }
    if (dto.phone !== undefined) {
      const phone = dto.phone === null ? null : canonicalizePhone(dto.phone);
      // Compared AFTER canonicalisation: '067 123 45 67' against a stored
      // '+380671234567' is not a change, and must not be checked against the
      // row itself and 409.
      if (phone && phone !== supplier.phone) await assertPhoneFree(this.repo, supplier.collection_point_id, phone, supplier.id);
      supplier.phone = phone;
    }
    if (dto.note !== undefined) supplier.note = dto.note;
    if (dto.kind != null) supplier.kind = dto.kind;
    if (dto.is_active != null) supplier.is_active = dto.is_active;

    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(Supplier).save(supplier);
      const diff = diffFields(before, snapshot(saved), SUPPLIER_FIELDS);

      if (diff) {
        await this.audit.record(
          {
            action: 'supplier.updated',
            actor_id: actor.sub,
            target_type: 'supplier',
            target_id: saved.id,
            before: diff.before,
            after: diff.after,
          },
          manager,
        );
      }

      return toSupplierResponse(saved);
    });
  }
}
