import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Supplier } from './supplier.entity';
import { SupplierKind } from './supplier-kind.enum';
import { canonicalizePhone } from './phone';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { ListSuppliersQueryDto } from './dto/list-suppliers.query';
import { SupplierResponse, toSupplierResponse } from './supplier.mapper';
import { AuditService } from '../audit/audit.service';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import { assertOwnsPoint, resolvePointFilter } from '../auth/access/point-scope';
import { assertTrimmedName } from '../common/trimmed-name';
import { diffFields } from '../common/diff-fields';
import { Paginated } from '../common/dto/paginated';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const SUPPLIER_FIELDS = ['first_name', 'last_name', 'phone', 'note', 'kind', 'is_active'] as const;

/** A `q` made only of digits and phone punctuation takes the phone lane.
 *  Unicode dashes are written as code points for the same reason as in
 *  `phone.ts` — a literal range is invisible in review. */
const LOOKS_LIKE_PHONE = /^[+\d\s()\-\u2010-\u2015]+$/;

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly repo: Repository<Supplier>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly points: CollectionPointsService,
  ) {}

  /**
   * PERFORMANCE, STATED RATHER THAN BURIED: the phone suffix `LIKE` and the
   * name substring `ILIKE` are not sargable, so neither PREDICATE can use
   * `IDX_suppliers_point_last_name` — the index still serves the
   * `collection_point_id` equality and the `last_name` ordering, which is most
   * of why the scan stays cheap. These are sequential scans WITHIN one point.
   * That is fine at hundreds of
   * suppliers per point and stops being fine somewhere in the low tens of
   * thousands, at which point the answer is a `pg_trgm` GIN index. That is
   * purely additive; do not pre-build it.
   */
  async list(
    actor: AuthenticatedUser,
    query: ListSuppliersQueryDto,
  ): Promise<Paginated<SupplierResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const qb = this.repo.createQueryBuilder('s');
    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    if (!query.include_inactive) qb.andWhere('s.is_active = true');

    const q = query.q?.trim();
    if (q) {
      if (LOOKS_LIKE_PHONE.test(q)) {
        const digits = q.replace(/\D/g, '');
        // A `q` of PURE PUNCTUATION («+», «()», «--») reduces to no digits and
        // deliberately drops the filter rather than matching nothing: it is
        // the same end state as the whitespace-only case below, and «typed
        // punctuation, got the unfiltered list» beats «got an empty screen».
        if (digits) {
          // A FULL number is matched exactly on its canonical form; a partial
          // one on its suffix, because «останні чотири цифри?» is how this is
          // actually asked out loud. `canonicalizePhone` may reject a partial
          // number — searching is not entry, so a failure falls back to the
          // suffix match instead of 400ing the search.
          const exact = this.tryCanonicalize(q);
          if (exact) qb.andWhere('s.phone = :phone', { phone: exact });
          else qb.andWhere('s.phone LIKE :phone', { phone: `%${digits}` });
        }
      } else {
        // `q` is parameterized, so there is no injection risk — but `%` and
        // `_` are ILIKE metacharacters and would pass through into the
        // pattern unescaped: `?q=%` would then match every supplier in scope
        // and `?q=_` any single character. Escaping them (and a literal
        // backslash, so the escape character itself can't be forged) plus a
        // named ESCAPE clause keeps the search literal.
        const escaped = q.replace(/[%_\\]/g, '\\$&');
        qb.andWhere(
          "(s.first_name ILIKE :q ESCAPE '\\' OR s.last_name ILIKE :q ESCAPE '\\')",
          { q: `%${escaped}%` },
        );
      }
    }

    const [data, total] = await qb
      .orderBy('s.last_name', 'ASC')
      .addOrderBy('s.first_name', 'ASC')
      // Tiebreaker, not a third sort key anyone reads. §6.3 refuses name
      // uniqueness outright — two «Іван Коваль»s at one point are ordinary —
      // and §3.9 makes the tie STRUCTURAL for an owner reading network-wide,
      // since one person delivering to two points is two rows with identical
      // names. Postgres promises no order among tied rows, so without this
      // `skip`/`take` can return one twice across pages or drop it entirely.
      // Same reasoning as `ProductGradesService.list`.
      .addOrderBy('s.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    return { data: data.map(toSupplierResponse), total, page: query.page, limit: query.limit };
  }

  /**
   * 404 — NOT 403 — for a supplier at another point. `GET
   * /collection-points/:id` distinguishes the two, and the foundation
   * follow-ups flag that as a weak existence oracle «worth remembering before
   * this shape is copied onto a guessable id». This is the copy, and these
   * rows are real people's names and phone numbers.
   */
  async findOne(actor: AuthenticatedUser, id: string): Promise<SupplierResponse> {
    const supplier = await this.repo.findOne({ where: { id } });
    if (!supplier || !this.visibleTo(actor, supplier)) {
      throw new NotFoundException('Supplier not found');
    }
    return toSupplierResponse(supplier);
  }

  async create(actor: AuthenticatedUser, dto: CreateSupplierDto): Promise<SupplierResponse> {
    const pointId = this.resolveWritePoint(actor, dto.collection_point_id);
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
    if (phone) await this.assertPhoneFree(pointId, phone);

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

    const before = this.snapshot(supplier);

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
      if (phone && phone !== supplier.phone) await this.assertPhoneFree(supplier.collection_point_id, phone, supplier.id);
      supplier.phone = phone;
    }
    if (dto.note !== undefined) supplier.note = dto.note;
    if (dto.kind != null) supplier.kind = dto.kind;
    if (dto.is_active != null) supplier.is_active = dto.is_active;

    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(Supplier).save(supplier);
      const diff = diffFields(before, this.snapshot(saved), SUPPLIER_FIELDS);

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

  /** An operator's point is derived from their token — a body value naming a
   *  different point is refused. An owner has no point of their own and must
   *  name one, which is then validated with `assertOwnsPoint` (a no-op for an
   *  owner, since they own every point). */
  private resolveWritePoint(actor: AuthenticatedUser, requested?: string): string {
    if (actor.collection_point_id && !requested) return actor.collection_point_id;
    if (!requested) {
      throw new BadRequestException({
        message: 'collection_point_id is required',
        code: 'COLLECTION_POINT_REQUIRED',
      });
    }
    assertOwnsPoint(actor, requested);
    return requested;
  }

  private visibleTo(actor: AuthenticatedUser, supplier: Supplier): boolean {
    if (actor.role === UserRole.NetworkOwner) return true;
    return actor.collection_point_id === supplier.collection_point_id;
  }

  private tryCanonicalize(raw: string): string | null {
    try {
      return canonicalizePhone(raw);
    } catch {
      return null;
    }
  }

  private snapshot(s: Supplier): Record<(typeof SUPPLIER_FIELDS)[number], unknown> {
    return {
      first_name: s.first_name,
      last_name: s.last_name,
      phone: s.phone,
      note: s.note,
      kind: s.kind,
      is_active: s.is_active,
    };
  }

  /**
   * The friendly 409. `UQ_suppliers_point_phone` is the real guarantee — this
   * is a check-then-act and two concurrent creates can both pass it, leaving
   * the loser with a 500 instead of a 409. That matches the pre-existing shape
   * in `CollectionPointsService`, `UserAdminService` and the three catalog
   * services; recorded for consistency, not as a new defect.
   */
  private async assertPhoneFree(
    pointId: string,
    phone: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.repo
      .createQueryBuilder('s')
      .where('s.collection_point_id = :pointId AND s.phone = :phone', { pointId, phone })
      .getOne();

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({
        message: 'A supplier with that phone already exists at this point',
        code: 'SUPPLIER_PHONE_TAKEN',
      });
    }
  }
}
