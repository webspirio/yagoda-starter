import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CrateIssuance } from './crate-issuance.entity';
import { CrateReturn } from './crate-return.entity';
import { CrateReturnAllocation } from './crate-return-allocation.entity';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { CreateCrateIssuanceDto } from './dto/create-crate-issuance.dto';
import { CreateCrateReturnDto } from './dto/create-crate-return.dto';
import { CrateIssuanceResponse, toCrateIssuanceResponse } from './crate-issuance.mapper';
import {
  CrateReturnResponse,
  CrateReturnPreviewResponse,
  toCrateReturnResponse,
  joinIssuanceInfo,
} from './crate-return.mapper';
import { allocate } from './crate-allocation';
import { CrateBalanceService } from './crate-balance.service';
import { nextIssuanceCode } from './crate-code';
import { ShiftsService } from '../shifts/shifts.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import { TareTypesService } from '../tare-types/tare-types.service';
import { AuditService } from '../audit/audit.service';
import { mul, lt } from '../common/money';
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
    private readonly balance: CrateBalanceService,
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

  /**
   * §6.5 — the oldest issuance first, at the price it was taken at. The
   * operator chooses nothing.
   *
   * THE SUPPLIER ROW IS LOCKED FIRST, exactly as `PayoutsService.create` locks
   * it: the tranches are a read-then-write over a derived sum, and no CHECK can
   * express «not more than is outstanding». Without the lock two returns in
   * flight both read `remaining = 20`, both allocate it, and the supplier is
   * refunded twice for one set of crates. The lock does NOT protect
   * `pointDepositBook` below — that reads a sum across the WHOLE POINT while
   * only one supplier row is held, so two returns for different suppliers at
   * the same point can still race past its check. It stays a same-transaction
   * read regardless, because it is a guard against a state FIFO already
   * guarantees cannot occur (§6.7's comment on that call), not a second
   * invariant this method enforces.
   *
   * OVER-RETURN IS A 400, NEVER A SILENT CLAMP. Правка 15's case — 25 arrive
   * against 20 issued — is resolved at the counter: 20 enter the system and the
   * other 5 are the supplier's own, swapped for empties, «в системі це не
   * записується». A server that quietly wrote 20 when asked for 25 would be
   * editing a document.
   */
  async returnCrates(
    actor: AuthenticatedUser,
    dto: CreateCrateReturnDto,
  ): Promise<CrateReturnResponse> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);

    const supplier = await this.suppliers.findOne(actor, dto.supplier_id);
    if (supplier.collection_point_id !== pointId) {
      throw new NotFoundException('Supplier not found');
    }

    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [dto.supplier_id]);

      const shift = await this.shifts.findOpenAtPoint(pointId, m);
      if (!shift) {
        throw new ConflictException({
          message: 'No open shift at this point — open one first',
          code: 'NO_OPEN_SHIFT',
        });
      }

      // Read INSIDE the transaction, under the lock — otherwise the value
      // checked is not the value that was locked.
      const tranches = await this.balance.tranchesFor(dto.supplier_id, m);
      const result = allocate(tranches, dto.units);

      if (result.shortfall > 0) {
        const outstanding = dto.units - result.shortfall;
        // The message NAMES the number, because a refusal the operator cannot
        // act on just gets retried with the same input.
        throw new BadRequestException({
          message: `That supplier is holding ${outstanding} crates, not ${dto.units}`,
          code: 'RETURN_EXCEEDS_OUTSTANDING',
        });
      }

      /**
       * §6.7, AND IT SHOULD NEVER FIRE. FIFO guarantees a refund never exceeds
       * what this supplier deposited, so the point's crates book cannot go
       * negative through any sequence of valid documents. It ships anyway: if
       * it ever fires, the data is wrong, and a named 409 beats a silently
       * negative drawer. The REAL §6.7 risk — deposit cash spent on berries out
       * of the one physical drawer — is invisible to a book nobody counts.
       */
      const book = await this.balance.pointDepositBook(pointId, m);
      if (lt(book, result.deposit_refund)) {
        throw new ConflictException({
          message: `The crate deposits book holds ${book}, less than the ${result.deposit_refund} this return refunds`,
          code: 'CRATE_CASH_INSUFFICIENT',
        });
      }

      const ret = await m.save(
        CrateReturn,
        m.create(CrateReturn, {
          shift_id: shift.id,
          supplier_id: supplier.id,
          units: dto.units,
          deposit_refund: result.deposit_refund,
          accepted_by_user_id: actor.sub,
        }),
      );

      for (const row of result.allocations) {
        await m.save(
          CrateReturnAllocation,
          m.create(CrateReturnAllocation, {
            return_id: ret.id,
            issuance_id: row.issuance_id,
            units: row.units,
            per_unit: row.per_unit,
            amount: row.amount,
          }),
        );
      }

      await this.audit.record(
        {
          action: 'crate-return.created',
          actor_id: actor.sub,
          target_type: 'crate_return',
          target_id: ret.id,
          after: {
            units: dto.units,
            deposit_refund: result.deposit_refund,
            supplier_id: supplier.id,
          },
        },
        m,
      );

      return toCrateReturnResponse(ret, shift, result.allocations, tranches);
    });
  }

  /**
   * Create minus the write — the same seam as `POST /intakes/preview`.
   *
   * IT EXISTS BECAUSE THE SERVER OWNS FIFO. The reception screen must show
   * «20 × 120,00 = 2 400,00 ₴» before the operator commits; if the only way to
   * learn that number were to POST the return, the client would reimplement the
   * allocator to fill the label, and the two would disagree the first time a
   * void landed.
   *
   * NO LOCK AND NO SHIFT CHECK: nothing is written, and a preview that refused
   * outside a shift would be useless exactly when the operator is deciding
   * whether to open one.
   *
   * SAME ENRICHED SHAPE AS THE WRITTEN DOCUMENT. The preview IS the screen the
   * operator reads before committing, so «25 за розпискою, без грошей» matters
   * more here than on the receipt afterwards — `joinIssuanceInfo` is the same
   * function `toCrateReturnResponse` uses, so the two never disagree about
   * what an allocation row looks like.
   */
  async previewReturn(
    actor: AuthenticatedUser,
    dto: CreateCrateReturnDto,
  ): Promise<CrateReturnPreviewResponse> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);
    const supplier = await this.suppliers.findOne(actor, dto.supplier_id);
    if (supplier.collection_point_id !== pointId) {
      throw new NotFoundException('Supplier not found');
    }

    const tranches = await this.balance.tranchesFor(dto.supplier_id);
    const result = allocate(tranches, dto.units);

    return {
      allocations: joinIssuanceInfo(result.allocations, tranches),
      deposit_refund: result.deposit_refund,
      shortfall: result.shortfall,
    };
  }
}
