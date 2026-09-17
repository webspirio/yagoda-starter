import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Reweigh } from './reweigh.entity';
import { ReweighItem } from './reweigh-item.entity';
import { ReweighItemTareType } from './reweigh-item-tare-type.entity';
import { CreateReweighItemDto } from './dto/create-reweigh-item.dto';
import { VoidDocumentDto } from '../intakes/dto/void-document.dto';
import { ReweighItemResponse, toReweighItemResponse } from './reweigh-item.mapper';
import { ShiftsService } from '../shifts/shifts.service';
import { TareTypesService } from '../tare-types/tare-types.service';
import { AuditService } from '../audit/audit.service';
import { lte, mul, sub, sum } from '../common/money';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Injectable()
export class ReweighsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
    private readonly tareTypes: TareTypesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * §8.1 — one weighing on the scale.
   *
   * NO SHIFT-STATUS GATE (spec §3.9). §8.3's «Один рейс на три пункти» is a
   * mid-day trip by construction: the first point's berries are at the base
   * while that point is still buying. Refusing an open shift here would make
   * that ordinary day unrecordable, and the workaround would be to close the
   * shift early — corrupting it to satisfy the schema. The open-shift caveat
   * lives in the READ instead, where недостача reports `null`.
   *
   * THE HEADER IS CREATED LAZILY, and the upsert is not laziness about
   * concurrency: two first lines arriving together must not both insert, so it
   * is `ON CONFLICT DO NOTHING` followed by a read, inside the transaction.
   */
  async addItem(
    actor: AuthenticatedUser,
    shiftId: string,
    dto: CreateReweighItemDto,
  ): Promise<ReweighItemResponse> {
    const shift = await this.shifts.findOneRaw(shiftId);
    if (!shift) throw new NotFoundException('Shift not found');

    return this.dataSource.transaction(async (m) => {
      const reweigh = await this.ensureHeader(m, shiftId);

      const accepted = await this.acceptedGrades(m, shiftId);
      if (accepted.length === 0) {
        throw new ConflictException({
          message: 'Nothing was accepted at this point that day',
          code: 'NOTHING_ACCEPTED',
        });
      }
      if (!accepted.includes(dto.product_grade_id)) {
        throw new BadRequestException({
          message: 'That grade was not accepted by this shift',
          code: 'GRADE_NOT_ACCEPTED',
        });
      }

      // Spec §5.1 orders the checks 1-5 with tare at 4, and the order is the
      // message the client asked for: «Того дня тут нічого не приймали» has to
      // win over an unknown tare type, or §8.1's own example is reachable only
      // once everything else about the request is already valid. Resolved
      // INSIDE the transaction (and through `m`) for the same reason
      // `IntakesService.snapshotTare` is — the snapshot and the line it is
      // snapshotted onto are one atomic read-then-write, not two.
      const tareWeight = await this.resolveTareWeight(dto, m);

      const pallet = dto.pallet_kg ?? '0.00';
      // §8.1 — pallet FIRST, tare second. Never a human's number.
      const net = sub(sub(dto.gross_kg, pallet), tareWeight);
      if (lte(net, '0.00')) {
        throw new BadRequestException({
          message: 'Pallet and tare leave no net weight',
          code: 'NET_NOT_POSITIVE',
        });
      }

      const [{ next }] = (await m.query(
        `SELECT COALESCE(MAX(item_order), 0) + 1 AS next
           FROM reweigh_items WHERE reweigh_id = $1`,
        [reweigh.id],
      )) as [{ next: number }];

      const item = m.create(ReweighItem, {
        reweigh_id: reweigh.id,
        // A ROW COUNT, NOT MONEY. Spelled `Number.parseInt` rather than
        // `Number(...)` because this file is inside the eslint money guard and
        // that selector matches the bare global only — the same sanctioned
        // spelling `crate-balance.service.ts` uses, for the same reason.
        item_order: Number.parseInt(String(next), 10),
        product_grade_id: dto.product_grade_id,
        gross_kg: dto.gross_kg,
        pallet_kg: pallet,
        tare_weight_kg: tareWeight,
        net_kg: net,
        weighed_by_user_id: actor.sub,
        voided_at: null,
        voided_by_user_id: null,
        void_reason: null,
        tare: dto.tare.map((t) =>
          m.create(ReweighItemTareType, { tare_type_id: t.tare_type_id, units: t.units }),
        ),
      });

      const saved = await m.save(ReweighItem, item);

      // RE-READ WITH RELATIONS. `m.save` returns the entity it was handed, and
      // that one carries `product_grade_id`/`tare_type_id` but no loaded
      // `product_grade` or `tare_type` — so `toReweighItemResponse` would fill
      // `product_grade_name`, `product_id`, `product_name` and every
      // `tare[].tare_type_name` with `undefined`. `voidItem` reads its row
      // WITH those relations and returns them, so without this the same
      // TypeScript type came back in two different shapes depending on which
      // verb produced it, and the create response — the one the reception
      // screen renders immediately — was the impoverished one.
      const withRelations = await m.findOneOrFail(ReweighItem, {
        where: { id: saved.id },
        relations: { product_grade: { product: true }, tare: { tare_type: true } },
      });

      await this.audit.record(
        {
          action: 'reweigh-item.created',
          actor_id: actor.sub,
          target_type: 'reweigh_item',
          target_id: saved.id,
          after: { shift_id: shiftId, net_kg: saved.net_kg, grade: saved.product_grade_id },
        },
        m,
      );

      return toReweighItemResponse(withRelations);
    });
  }

  /**
   * `Σ units × tare_types.weight_kg`, SNAPSHOTTED onto the line.
   *
   * The catalogue weight is editable (see `tare_types`' Note); reading it at
   * report time instead would let a change to «Чешка» rewrite last week's net
   * weight, and the недостача with it.
   */
  private async resolveTareWeight(dto: CreateReweighItemDto, m: EntityManager): Promise<string> {
    if (dto.tare.length === 0) return '0.00';

    // THE SAME REFUSAL `intake-lines.ts` MAKES, for the same reason: both
    // entries would resolve against the map below and be summed, double-
    // counting the units into `tare_weight_kg`, and the cascade insert would
    // then die on `PK_reweigh_item_tare_types` — a 23505 no `QueryFailedError`
    // mapping in this backend catches, so an ordinary typo would surface as a
    // generic 500 instead of a message naming the tare type.
    const seen = new Set<string>();
    for (const t of dto.tare) {
      if (seen.has(t.tare_type_id)) {
        throw new BadRequestException({
          message: `tare type ${t.tare_type_id} is listed twice on one line — record it once with the total units`,
          code: 'TARE_TYPE_DUPLICATED',
        });
      }
      seen.add(t.tare_type_id);
    }

    // `findManyRaw`, not a lookup per line: the tare breakdown is up to ten
    // rows and a loop of awaits here is an N+1 on the hottest write in §8.
    const ids = dto.tare.map((t) => t.tare_type_id);
    const types = await this.tareTypes.findManyRaw(ids, m);
    const byId = new Map(types.map((t) => [t.id, t]));

    const parts = dto.tare.map((line) => {
      const type = byId.get(line.tare_type_id);
      // `findManyRaw` filters `is_active`, so a DEACTIVATED type lands here
      // too — which is why this says «unknown or inactive» and matches
      // `intakes`' `TARE_TYPE_UNKNOWN` rather than reading as a bare 404 that
      // blames the id.
      if (!type) {
        throw new BadRequestException({
          message: `Unknown or inactive tare type ${line.tare_type_id}`,
          code: 'TARE_TYPE_UNKNOWN',
        });
      }
      // `units` is a COUNT, so it is widened to a scale-2 string rather than
      // multiplied as a number — foundation §5.1 binds weights too.
      return mul(type.weight_kg, `${line.units}.00`);
    });
    return sum(parts);
  }

  /**
   * `FOR UPDATE` on the read is not about the upsert — the upsert is already
   * safe on its own via `UQ_reweighs_shift`. It is what makes THIS ROW the
   * serialization point for `item_order` (spec §5.1: «`item_order` is
   * `MAX(item_order) + 1` within the header, taken under `SELECT … FOR
   * UPDATE` on the header row»). Once a header already exists, `ON CONFLICT
   * DO NOTHING` no-ops immediately WITHOUT blocking — it only protects
   * against two inserts, not two readers. Without the lock here, two
   * concurrent lines later in the same shift's day could both read the same
   * `MAX(item_order)`, both attempt the same value, and `UQ_reweigh_items_order`
   * would turn an ordinary second pallet into a raw 500 for the loser instead
   * of a clean sequential 1, 2, 3. The lock is held until the transaction
   * commits or rolls back, so the loser simply queues behind the winner.
   */
  private async ensureHeader(m: EntityManager, shiftId: string): Promise<Reweigh> {
    await m.query(
      `INSERT INTO reweighs (shift_id) VALUES ($1) ON CONFLICT (shift_id) DO NOTHING`,
      [shiftId],
    );
    const rows = (await m.query(
      `SELECT id FROM reweighs WHERE shift_id = $1 FOR UPDATE`,
      [shiftId],
    )) as {
      id: string;
    }[];
    // Unreachable under READ COMMITTED — the upsert above either inserted the
    // row or blocked on the transaction that did, and nothing deletes a
    // `reweighs` header. Spelled out anyway so a future delete path fails as a
    // named error rather than as `Cannot read properties of undefined`.
    if (!rows[0]) throw new ConflictException('Reweigh header vanished while being created');
    return { id: rows[0].id, shift_id: shiftId } as Reweigh;
  }

  /** The grades this shift actually accepted — §8.1's picker, enforced. */
  private async acceptedGrades(m: EntityManager, shiftId: string): Promise<string[]> {
    const rows = (await m.query(
      `SELECT DISTINCT ii.product_grade_id
         FROM intake_items ii
         JOIN intakes i ON i.id = ii.intake_id
        WHERE i.shift_id = $1 AND i.voided_at IS NULL`,
      [shiftId],
    )) as { product_grade_id: string }[];
    return rows.map((r) => r.product_grade_id);
  }

  /**
   * §8.7 — the storno of a weighing.
   *
   * NO AUTHOR CHECK AND NO SHIFT-STATUS CHECK, and neither is an omission.
   * §9.4's «свій документ, своя відкрита зміна» governs the OPERATOR's
   * documents; §8.7 gives both weighing and voiding to the owner outright, and
   * the controller's class-level `@Auth(UserRole.NetworkOwner)` is the whole
   * rule. There is nobody left for a row-level check to exclude.
   *
   * THE ROW STAYS. «документ НЕ зникає: лишається з позначкою "сторновано",
   * часом, автором і причиною» — which is the trio, not a DELETE and not a
   * status.
   */
  async voidItem(
    actor: AuthenticatedUser,
    id: string,
    dto: VoidDocumentDto,
  ): Promise<ReweighItemResponse> {
    return this.dataSource.transaction(async (m) => {
      const item = await m.findOne(ReweighItem, {
        where: { id },
        relations: { product_grade: { product: true }, tare: { tare_type: true } },
      });
      if (!item) throw new NotFoundException('Reweigh line not found');
      if (item.voided_at) {
        throw new ConflictException({
          message: 'That line is already voided',
          code: 'ALREADY_VOIDED',
        });
      }

      item.voided_at = new Date();
      item.voided_by_user_id = actor.sub;
      item.void_reason = dto.reason;
      const saved = await m.save(ReweighItem, item);

      await this.audit.record(
        {
          action: 'reweigh-item.voided',
          actor_id: actor.sub,
          target_type: 'reweigh_item',
          target_id: saved.id,
          note: dto.reason,
        },
        m,
      );

      return toReweighItemResponse(saved);
    });
  }
}
