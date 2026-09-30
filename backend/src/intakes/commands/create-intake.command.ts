import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Intake } from '../intake.entity';
import { IntakeItem } from '../intake-item.entity';
import { IntakeItemTareType } from '../intake-item-tare-type.entity';
import type { BuiltIntake } from '../intake-lines';
import { CreateIntakeDto } from '../dto/create-intake.dto';
import { IntakeDetailResponse, toIntakeDetailResponse } from '../intake.mapper';
import { PriceIntakeQuery } from '../queries/price-intake.query';
import { IntakeDetailQuery } from '../queries/intake-detail.query';
import { Payout } from '../../payouts/payout.entity';
import { PayoutWriter } from '../../payouts/services/payout-writer';
import { AllocationsService } from '../../supplier-balance/services/allocations';
import { CratesService } from '../../crates/crates.service';
import { CrateStockGuard } from '../../crate-stock/crate-stock.guard';
import { AuditService } from '../../audit/audit.service';
import { nextDocumentCode } from '../../common/document-code';
import { isZero } from '../../common/money';
import { translateUniqueViolation } from '../../common/unique-violation';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * One POST, one transaction, the whole receipt (§2.3) — and, since 2026-09-21, the payout
 * handed over with it (§2.1 ⑥). No update path exists: §2.7 freezes `amount`, §9.3 corrects
 * by void plus a new document. Since 2026-09-24 it may also write the return of OUR crates the
 * supplier brought back (`returned_crates`, spec §8.3) through `CratesService.writeReturn`; any
 * refusal from either writer rolls back the WHOLE receipt.
 */
@Injectable()
export class CreateIntakeCommand {
  constructor(
    private readonly dataSource: DataSource,
    private readonly pricing: PriceIntakeQuery,
    private readonly allocations: AllocationsService,
    private readonly payouts: PayoutWriter,
    private readonly crates: CratesService,
    private readonly audit: AuditService,
    private readonly detail: IntakeDetailQuery,
    private readonly stock: CrateStockGuard,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateIntakeDto): Promise<IntakeDetailResponse> {
    const { pointId, point, supplier } = await this.pricing.target(actor, dto);

    return this.dataSource.transaction(async (m) => {
      const { intake, shift, paid } = await this.allocations.withinSupplierLedger(
        m,
        supplier.id,
        async () => {
          const { shift, built } = await this.pricing.price(pointId, dto, m);

          // Spec §8.3 — the crates coming back must be crates THIS receipt carries. More is a
          // typo or a tare line typed as the wrong type, and would refund deposit for crates
          // nobody weighed in.
          const returned = dto.returned_crates ?? 0;
          if (returned > built.crate_units) {
            throw new BadRequestException({
              message: `Only ${built.crate_units} crates on this receipt are crate tare`,
              code: 'RETURNED_EXCEEDS_TARE',
            });
          }
          const code = await nextDocumentCode(m, {
            pointCode: point.code,
            businessDate: shift.business_date,
            kind: 'IN',
            shiftId: shift.id,
            table: 'intakes',
          });
          const intake = await this.insert(m, actor, code, shift.id, supplier.id, built);
          await this.audit.record(
            {
              action: 'intake.created',
              actor_id: actor.sub,
              target_type: 'intake',
              target_id: intake.id,
              after: { code, amount: built.amount, supplier_id: supplier.id },
            },
            m,
          );

          // Spec §8.3 — BEFORE the payout, so a crates refusal rolls back a receipt that has not
          // handed any cash over yet. `intakeId` is what lets this receipt's void strike it too.
          if (returned > 0) {
            await this.crates.writeReturn(m, {
              actor,
              pointId,
              shift,
              supplierId: supplier.id,
              units: returned,
              intakeId: intake.id,
            });
          }

          // Spec 2026-09-30 — full crates are always ours, so the crate tare this receipt weighs
          // comes out of the empties, less any it gives back (`returned`). Before the payout, so a
          // refusal hands no cash over.
          const taken = built.crate_units - returned;
          if (taken > 0) await this.stock.assertOnHand(m, pointId, taken);

          // §2.1 ⑥ — the cash leaves in the same transaction; a ceiling refusal rolls the receipt
          // back with it. Truthiness on purpose: absent, null and '' all mean «нічого не видано» (§3.7).
          const paid: Payout[] = [];
          if (dto.paid_amount && !isZero(dto.paid_amount)) {
            const { payout } = await this.payouts.write(m, {
              actor,
              pointId,
              pointCode: point.code,
              supplierId: supplier.id,
              amount: dto.paid_amount,
              intakeId: intake.id,
            });
            paid.push(payout);
          }
          return { intake, shift, paid };
        },
      );

      // After the ledger's allocate: `open_amount` must see this receipt's allocations.
      return toIntakeDetailResponse(
        intake,
        shift,
        intake.items ?? [],
        await this.detail.extras(intake.id, m),
        paid,
        await this.detail.receiverName(actor.sub, m),
        await this.detail.crateReturn(intake.id, m),
      );
    });
  }

  /** Only this insert can hit `UQ_intakes_code` — a shift numbered by hand before 2026-09-18. */
  private async insert(
    m: EntityManager,
    actor: AuthenticatedUser,
    code: string,
    shiftId: string,
    supplierId: string,
    built: BuiltIntake,
  ): Promise<Intake> {
    try {
      return await m.save(
        Intake,
        m.create(Intake, {
          code,
          shift_id: shiftId,
          supplier_id: supplierId,
          amount: built.amount,
          // §10.6 — the signature belongs to whoever pressed the button.
          received_by_user_id: actor.sub,
          items: built.items.map((line) =>
            m.create(IntakeItem, {
              item_order: line.item_order,
              product_grade_id: line.product_grade_id,
              gross_kg: line.gross_kg,
              pallet_kg: line.pallet_kg,
              tare_weight_kg: line.tare_weight_kg,
              net_kg: line.net_kg,
              price: line.price,
              bonus: line.bonus,
              amount: line.amount,
              tare: line.tare.map((t) =>
                m.create(IntakeItemTareType, { tare_type_id: t.tare_type_id, units: t.units }),
              ),
            }),
          ),
        }),
      );
    } catch (error) {
      throw translateUniqueViolation(
        error,
        'UQ_intakes_code',
        () =>
          new ConflictException({
            message: `Receipt ${code} already exists — this shift was numbered by hand before the server took it over`,
            code: 'INTAKE_CODE_TAKEN',
          }),
      );
    }
  }
}
