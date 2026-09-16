import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
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
  CrateReturnIssuanceInfo,
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
import { UserRole } from '../users/user-role.enum';
import type { VoidDocumentDto } from '../intakes/dto/void-document.dto';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Injectable()
export class CratesService {
  constructor(
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
   * NO `CRATE_CASH_INSUFFICIENT` CHECK EITHER (§6.7, the crates-book guard
   * `returnCrates` runs before it writes). Harmless today because that check
   * can never fire under valid documents — FIFO guarantees a refund never
   * exceeds what the supplier deposited, so the book cannot go negative
   * through any sequence of real documents; a preview that skips a check
   * which exists only to catch impossible data loses nothing a supplier or
   * operator would ever see.
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

  /**
   * §9.4 AS AMENDED BY THE CLIENT, 2026-09-15 — and the amendment is the whole
   * reason this is not `PayoutsService.loadForWrite`.
   *
   * The rules table says «ящиковий документ → тільки керівник». The client
   * relaxed it: an operator may void ANY crate document at their OWN point
   * while that shift is OPEN. No author check — §10.6's mid-shift cashier swap
   * routinely leaves the person at the counter holding a colleague's mistake.
   *
   * A CLOSED SHIFT IS STILL THE OWNER'S ALONE («квитанція минулого дня → тільки
   * керівник»), and that bound is load-bearing: spec §7 lets a void drop a
   * taken deposit straight out of the crates book with no counted figure
   * anywhere to notice. Today's mistake is the operator's to fix; last week's
   * is not.
   */
  private assertMayVoid(
    actor: AuthenticatedUser,
    shift: { collection_point_id: string; closed_at: Date | null },
  ): void {
    if (actor.role === UserRole.NetworkOwner) return;

    if (actor.collection_point_id !== shift.collection_point_id) {
      // 404 upstream, not 403 — see `loadIssuanceForWrite`.
      throw new NotFoundException('Document not found');
    }
    if (shift.closed_at) {
      throw new ForbiddenException({
        message: 'That shift is closed — ask the network owner',
        code: 'SHIFT_CLOSED',
      });
    }
  }

  async voidIssuance(
    actor: AuthenticatedUser,
    id: string,
    dto: VoidDocumentDto,
  ): Promise<CrateIssuanceResponse> {
    // THE LOAD AND THE STATE CHECK ARE INSIDE THE TRANSACTION, under the row
    // lock: checking `voided_at` before the transaction opens is a
    // check-then-write, and two taps produce two audit entries naming possibly
    // different actors while `voided_by_user_id` is last-writer-wins.
    return this.dataSource.transaction(async (m) => {
      // A cheap, UNLOCKED read, only to learn who the supplier is — 404s
      // before any lock is taken if the document simply does not exist.
      const stub = await m.findOne(CrateIssuance, { where: { id } });
      if (!stub) throw new NotFoundException('Crate issuance not found');

      /**
       * THE SUPPLIER ROW IS LOCKED FIRST — before this document's own
       * pessimistic load — and this ordering is the whole fix.
       *
       * WHY THE LOCK EXISTS AT ALL: under READ COMMITTED, a void that only
       * locks the issuance leaves the supplier uncontended. `returnCrates`
       * can then lock the supplier, read `tranchesFor` on a snapshot where
       * this issuance still looks live, and allocate against it; its
       * allocation INSERT needs `FOR KEY SHARE` on the parent issuance and
       * blocks behind this transaction's issuance lock; this transaction
       * commits the void; the other transaction's FK re-check sees the row
       * still EXISTS (voided ≠ deleted) and succeeds. The result is a live
       * allocation against a voided issuance — `tranchesFor` filters
       * `voided_at IS NULL` so the capacity silently vanishes, and
       * `crateBookSql` subtracts the refund it never added the deposit
       * for, so the point's crates book can go negative.
       *
       * WHY IT MUST BE FIRST: `returnCrates` locks the supplier BEFORE its
       * document-level work. A void that took the issuance lock first and
       * the supplier lock second would acquire the two locks in the
       * opposite order from `returnCrates` — a classic lock-order inversion
       * — and the two can then deadlock on each other instead of one simply
       * waiting for the other. Acquiring supplier-then-document here, the
       * same order `returnCrates` uses, is what makes waiting safe.
       */
      await m.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [stub.supplier_id]);

      const issuance = await m.findOne(CrateIssuance, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!issuance) throw new NotFoundException('Crate issuance not found');

      const shift = await this.shifts.findOneRaw(issuance.shift_id, m);
      if (!shift) throw new NotFoundException('Crate issuance not found');

      // The point-mismatch 404 lives in `assertMayVoid` alone — see its doc
      // comment. A second copy here would just be a second place to forget
      // to update.
      this.assertMayVoid(actor, shift);

      if (issuance.voided_at) {
        throw new ConflictException({
          message: 'That issuance is already voided',
          code: 'ALREADY_VOIDED',
        });
      }

      /**
       * §9.3 — «видачу, на яку вже лягло повернення, сторнувати не можна, поки
       * не сторновано повернення». Voiding it out from under a live allocation
       * would refund crates that, on the books, were never issued.
       */
      const live: Array<{ n: number }> = await m.query(
        `SELECT count(*)::int AS n
           FROM crate_return_allocations a
           JOIN crate_returns cr ON cr.id = a.return_id
          WHERE a.issuance_id = $1 AND cr.voided_at IS NULL`,
        [id],
      );
      if (live[0]?.n > 0) {
        throw new ConflictException({
          message: 'A return has already been allocated against this issuance — void the return first',
          code: 'ISSUANCE_HAS_RETURNS',
        });
      }

      issuance.voided_at = new Date();
      issuance.voided_by_user_id = actor.sub;
      issuance.void_reason = dto.reason;
      const saved = await m.save(CrateIssuance, issuance);

      await this.audit.record(
        {
          action: 'crate-issuance.voided',
          actor_id: actor.sub,
          target_type: 'crate_issuance',
          target_id: saved.id,
          after: { code: saved.code, units: saved.units, deposit_taken: saved.deposit_taken },
          note: dto.reason,
        },
        m,
      );

      return toCrateIssuanceResponse(saved, shift);
    });
  }

  /**
   * VOIDING A RETURN RESTORES TRANCHE CAPACITY WITHOUT TOUCHING A SINGLE
   * ALLOCATION ROW. The capacity comes back through `cr.voided_at IS NULL` in
   * `tranchesFor`; deleting the rows would destroy the evidence §9.3 keeps
   * «НАЗАВЖДИ з печаткою» and make the refund unexplainable afterwards.
   *
   * The money leaves the crates book at the same instant, by the same filter in
   * `crateBookSql`. Spec §7: cash physically changing hands afterwards is an
   * out-of-system act — правка 11, «система підказує, а керівник вирішує… за
   * межами системи».
   */
  async voidReturn(
    actor: AuthenticatedUser,
    id: string,
    dto: VoidDocumentDto,
  ): Promise<CrateReturnResponse> {
    return this.dataSource.transaction(async (m) => {
      // A cheap, UNLOCKED read, only to learn who the supplier is — 404s
      // before any lock is taken if the document simply does not exist.
      const stub = await m.findOne(CrateReturn, { where: { id } });
      if (!stub) throw new NotFoundException('Crate return not found');

      // THE SUPPLIER ROW IS LOCKED FIRST, before this document's own
      // pessimistic load — see `voidIssuance`'s doc comment for the full
      // interleaving this prevents and why the ordering (supplier, then
      // document — matching `returnCrates`) is what keeps the two from
      // deadlocking rather than merely waiting.
      await m.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [stub.supplier_id]);

      const ret = await m.findOne(CrateReturn, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ret) throw new NotFoundException('Crate return not found');

      const shift = await this.shifts.findOneRaw(ret.shift_id, m);
      if (!shift) throw new NotFoundException('Crate return not found');

      // The point-mismatch 404 lives in `assertMayVoid` alone — see its doc
      // comment. A second copy here would just be a second place to forget
      // to update.
      this.assertMayVoid(actor, shift);

      if (ret.voided_at) {
        throw new ConflictException({
          message: 'That return is already voided',
          code: 'ALREADY_VOIDED',
        });
      }

      ret.voided_at = new Date();
      ret.voided_by_user_id = actor.sub;
      ret.void_reason = dto.reason;
      const saved = await m.save(CrateReturn, ret);

      await this.audit.record(
        {
          action: 'crate-return.voided',
          actor_id: actor.sub,
          target_type: 'crate_return',
          target_id: saved.id,
          after: { units: saved.units, deposit_refund: saved.deposit_refund },
          note: dto.reason,
        },
        m,
      );

      // NO DELETE. The allocation rows stay exactly as they were — see this
      // method's doc comment — so the response is rebuilt from them, never
      // from a re-run of the allocator.
      const allocations = await m.find(CrateReturnAllocation, {
        where: { return_id: saved.id },
      });
      const issuanceIds = allocations.map((a) => a.issuance_id);
      const issuances = issuanceIds.length
        ? await m.find(CrateIssuance, { where: { id: In(issuanceIds) } })
        : [];
      const issuanceInfo: CrateReturnIssuanceInfo[] = issuances.map((i) => ({
        issuance_id: i.id,
        mode: i.mode,
        code: i.code,
      }));

      return toCrateReturnResponse(saved, shift, allocations, issuanceInfo);
    });
  }
}
