import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const TARGET_FIELDS = ['target_cash', 'target_crates'] as const;

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
    const name = this.assertNameValid(dto.name);
    await this.assertNameFree(name);

    const point = await this.repo.save(
      this.repo.create({
        name,
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
      after: { name: point.name, kind: point.kind },
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
    const before = { name: point.name, kind: point.kind, is_active: point.is_active };

    // `!= null` (not `!== undefined`) for the three NOT NULL columns: the DTO
    // rejects an explicit null on these with a 400 (see its doc comment), but
    // the guard stays defensive rather than trusting that upstream alone —
    // `!= null` excludes both `undefined` (field absent, leave alone) and
    // `null` (should never arrive here, and must not be assigned if it does).
    if (dto.name != null) {
      const name = this.assertNameValid(dto.name);
      if (name !== point.name) await this.assertNameFree(name, point.id);
      point.name = name;
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

    const movedTargets = TARGET_FIELDS.filter((f) => targetsBefore[f] !== targetsAfter[f]);
    if (movedTargets.length > 0) {
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
        before: Object.fromEntries(movedTargets.map((f) => [f, targetsBefore[f]])),
        after: Object.fromEntries(movedTargets.map((f) => [f, targetsAfter[f]])),
        note: dto.reason ?? null,
      });
    }

    const after = { name: saved.name, kind: saved.kind, is_active: saved.is_active };
    const movedFields = (Object.keys(before) as (keyof typeof before)[]).filter(
      (k) => before[k] !== after[k],
    );
    if (movedFields.length > 0) {
      await this.audit.record({
        action: 'point.updated',
        actor_id: actor.sub,
        target_type: 'collection_point',
        target_id: saved.id,
        before: Object.fromEntries(movedFields.map((k) => [k, before[k]])),
        after: Object.fromEntries(movedFields.map((k) => [k, after[k]])),
        note: dto.reason ?? null,
      });
    }

    return toCollectionPointResponse(saved);
  }

  private targetsOf(point: CollectionPoint): Record<(typeof TARGET_FIELDS)[number], unknown> {
    return { target_cash: point.target_cash, target_crates: point.target_crates };
  }

  /**
   * Trims a name and rejects an all-whitespace one with a 400 — done BEFORE
   * both the uniqueness check and the save. `@Length(1, 128)` on the DTO
   * counts whitespace toward length, so " " alone already passes it; without
   * trimming here, "dupe-check" and " dupe-check " render identically on the
   * transfer screen (a mistaken transfer there is real money in dispute) but
   * compare unequal to `UQ_collection_points_name`, defeating the whole point
   * of the constraint. See `normalize-login.ts` for why this trims but does
   * NOT lowercase — a point name is a display value, not an identifier.
   */
  private assertNameValid(raw: string): string {
    const name = raw.trim();
    if (!name) {
      throw new BadRequestException({
        message: 'name cannot be empty or all whitespace',
        code: 'POINT_NAME_EMPTY',
      });
    }
    return name;
  }

  /** A pre-check for a friendly 409, mirroring
   *  `UserAdminService.assertLoginFree`. The UNIQUE index
   *  (`UQ_collection_points_name`) is still the real guarantee — two
   *  simultaneous writes both pass this, and the loser gets a 500 rather than
   *  a silent duplicate. */
  private async assertNameFree(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { name } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException({ message: 'That name is taken', code: 'POINT_NAME_TAKEN' });
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
