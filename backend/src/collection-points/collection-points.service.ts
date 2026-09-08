import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectionPoint } from './collection-point.entity';
import { CreateCollectionPointDto } from './dto/create-collection-point.dto';
import { UpdateCollectionPointDto } from './dto/update-collection-point.dto';
import { ListCollectionPointsQueryDto } from './dto/list-collection-points.query';
import { CollectionPointResponse, toCollectionPointResponse } from './collection-point.mapper';
import { UsersService } from '../users/users.service';
import { displayNameOf } from '../users/display-name';
import { AuditService } from '../audit/audit.service';
import { assertOwnsPoint, resolvePointFilter } from '../auth/access/point-scope';
import { Paginated } from '../common/dto/paginated';
import { diffFields } from '../common/diff-fields';
import { assertTrimmedName } from '../common/trimmed-name';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const TARGET_FIELDS = ['target_cash', 'target_crates'] as const;

/**
 * Trims and upper-cases a point code. Normalizing HERE rather than in a DTO
 * `@Transform` follows how `name` is handled in this same service
 * (`assertTrimmedName`): one normalization pattern per module, and the value a
 * direct caller passes is treated the same as one that came over HTTP.
 * `CHK_collection_points_code` is the guarantee behind it.
 */
function normalizePointCode(raw: string): string {
  return raw.trim().toUpperCase();
}

@Injectable()
export class CollectionPointsService {
  constructor(
    @InjectRepository(CollectionPoint)
    private readonly repo: Repository<CollectionPoint>,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListCollectionPointsQueryDto,
  ): Promise<Paginated<CollectionPointResponse>> {
    const pointId = resolvePointFilter(actor);
    const where: Record<string, unknown> = {};
    // An operator sees exactly one row: their own point. Derived from the
    // actor, never from a query parameter.
    if (pointId) where.id = pointId;
    if (!query.include_inactive) where.is_active = true;

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { name: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return { data: data.map(toCollectionPointResponse), total, page: query.page, limit: query.limit };
  }

  /** The entity, unmapped and unscoped — for other modules that need to
   *  validate a point exists and is usable. Reads across domains are open;
   *  going through the owner keeps them from growing their own query. */
  async findOneRaw(id: string): Promise<CollectionPoint | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findOne(actor: AuthenticatedUser, id: string): Promise<CollectionPointResponse> {
    const point = await this.repo.findOne({ where: { id } });
    if (!point) throw new NotFoundException('Collection point not found');
    assertOwnsPoint(actor, point.id);
    return toCollectionPointResponse(point);
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateCollectionPointDto,
  ): Promise<CollectionPointResponse> {
    const name = assertTrimmedName(dto.name, 'name', 'POINT_NAME_EMPTY');
    await this.assertNameFree(name);
    const code = normalizePointCode(dto.code);
    await this.assertCodeFree(code);

    const point = await this.repo.save(
      this.repo.create({
        name,
        code,
        kind: dto.kind,
        // ?? null, never ?? 0 — see CollectionPoint's doc comment.
        target_cash: dto.target_cash ?? null,
        target_crates: dto.target_crates ?? null,
      }),
    );

    await this.audit.record({
      action: 'point.created',
      actor_id: actor.sub,
      target_type: 'collection_point',
      target_id: point.id,
      after: { name: point.name, code: point.code, kind: point.kind },
    });

    return toCollectionPointResponse(point);
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateCollectionPointDto,
  ): Promise<CollectionPointResponse> {
    const point = await this.repo.findOne({ where: { id } });
    if (!point) throw new NotFoundException('Collection point not found');

    if (dto.is_active === false && point.is_active) await this.assertNoActiveUsers(point.id);

    const targetsBefore = this.targetsOf(point);
    const before = {
      name: point.name,
      code: point.code,
      kind: point.kind,
      is_active: point.is_active,
    };

    // `!= null` (not `!== undefined`) for the three NOT NULL columns: the DTO
    // rejects an explicit null on these with a 400 (see its doc comment), but
    // the guard stays defensive rather than trusting that upstream alone —
    // `!= null` excludes both `undefined` (field absent, leave alone) and
    // `null` (should never arrive here, and must not be assigned if it does).
    if (dto.name != null) {
      const name = assertTrimmedName(dto.name, 'name', 'POINT_NAME_EMPTY');
      // Compared case-INSENSITIVELY, matching the unique index. A pure case
      // correction ("копайгород" → "Копайгород") is the same row, so it must
      // not be checked against itself and must not 409.
      if (name.toLowerCase() !== point.name.toLowerCase()) {
        await this.assertNameFree(name, point.id);
      }
      point.name = name;
    }
    if (dto.code != null) {
      const code = normalizePointCode(dto.code);
      if (code !== point.code) {
        await this.assertCodeFree(code, point.id);
        point.code = code;
      }
    }
    if (dto.kind != null) point.kind = dto.kind;
    if (dto.is_active != null) point.is_active = dto.is_active;
    // `!== undefined`, not a truthiness check: an explicit null CLEARS a target
    // back to "not known", while an absent field leaves it alone (§6.9).
    // Unlike the three fields above, target_cash/target_crates ARE nullable —
    // null here is meaningful, not a defect to guard against.
    //
    // And NOT `'target_cash' in dto`, which is what this used to say: this
    // repo's tsconfig targets ES2023, so `useDefineForClassFields` defaults to
    // TRUE and every declared field EXISTS on a DTO instance as `undefined`.
    // The global ValidationPipe runs `transform: true`, so what arrives here
    // is such an instance and `in` was ALWAYS true — meaning a
    // `PATCH {"name": "…"}` silently wiped both targets. Only `!== undefined`
    // tells absent from explicitly-null on a transformed DTO.
    if (dto.target_cash !== undefined) point.target_cash = dto.target_cash ?? null;
    if (dto.target_crates !== undefined) point.target_crates = dto.target_crates ?? null;

    const saved = await this.repo.save(point);
    const targetsAfter = this.targetsOf(saved);

    const targetDiff = diffFields(targetsBefore, targetsAfter, TARGET_FIELDS);
    if (targetDiff) {
      // The DBML says outright that author and reason for a target change are
      // "не зберігається" anywhere in the schema, since targets carry no
      // history. They are recorded HERE instead: the audit log is not target
      // state, it does not feed any calculation, and §6.1's own worked example
      // shows exactly this information.
      await this.audit.record({
        action: 'point.target-changed',
        actor_id: actor.sub,
        target_type: 'collection_point',
        target_id: saved.id,
        before: targetDiff.before,
        after: targetDiff.after,
        note: dto.reason ?? null,
      });
    }

    const after = {
      name: saved.name,
      code: saved.code,
      kind: saved.kind,
      is_active: saved.is_active,
    };
    // `code` is in the diff because it is the first segment of every receipt
    // written here from now on: a rename changes how new paper reads, and the
    // audit entry is the only record of when it changed.
    const fieldDiff = diffFields(before, after, ['name', 'code', 'kind', 'is_active']);
    if (fieldDiff) {
      await this.audit.record({
        action: 'point.updated',
        actor_id: actor.sub,
        target_type: 'collection_point',
        target_id: saved.id,
        before: fieldDiff.before,
        after: fieldDiff.after,
        note: dto.reason ?? null,
      });
    }

    return toCollectionPointResponse(saved);
  }

  private targetsOf(point: CollectionPoint): Record<(typeof TARGET_FIELDS)[number], unknown> {
    return { target_cash: point.target_cash, target_crates: point.target_crates };
  }

  /**
   * A pre-check for a friendly 409. `UQ_collection_points_name_lower` is still
   * the real guarantee — two simultaneous writes both pass this, and the
   * loser gets a 500 rather than a silent duplicate.
   *
   * `lower(...) = lower(...)` on BOTH sides, matching the index exactly: a
   * case-sensitive pre-check would let «копайгород» through to a constraint
   * violation, turning a 409 into a 500. The comparison is case-insensitive
   * because the index it guards is.
   */
  private async assertNameFree(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repo
      .createQueryBuilder('point')
      .where('lower(point.name) = lower(:name)', { name })
      .getOne();

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({ message: 'That name is taken', code: 'POINT_NAME_TAKEN' });
    }
  }

  /**
   * Same division of labour as `assertNameFree`: `UQ_collection_points_code` is
   * the real guarantee, this only produces the friendly 409 instead of a 500
   * from an unmapped `QueryFailedError`.
   *
   * No case fold here, unlike the name check — the DTO has already upper-cased
   * the value and `CHK_collection_points_code` rejects anything else, so
   * `lower()` on both sides would only hide a value that cannot be stored.
   */
  private async assertCodeFree(code: string, excludeId?: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { code } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException({ message: 'That code is taken', code: 'POINT_CODE_TAKEN' });
    }
  }

  /**
   * A point cannot be deactivated while someone still calls it home: their
   * token stays valid and every scoping assertion would silently match
   * nothing. The error names them so the owner knows what to reassign.
   *
   * TODO (when `shifts` lands): also refuse while an open shift exists at this
   * point. §7.8 — two open shifts are two books for one drawer; a point that
   * disappears under an open one is the same class of problem.
   */
  private async assertNoActiveUsers(pointId: string): Promise<void> {
    const assigned = await this.users.findActiveAtPoint(pointId);
    if (assigned.length === 0) return;

    const names = assigned.map(displayNameOf).join(', ');
    throw new ConflictException({
      message: `Reassign these users before deactivating this point: ${names}`,
      code: 'POINT_HAS_ACTIVE_USERS',
    });
  }
}
