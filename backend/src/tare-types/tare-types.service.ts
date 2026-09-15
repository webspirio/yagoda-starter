import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { TareType } from './tare-type.entity';
import { CreateTareTypeDto } from './dto/create-tare-type.dto';
import { UpdateTareTypeDto } from './dto/update-tare-type.dto';
import { ListTareTypesQueryDto } from './dto/list-tare-types.query';
import { TareTypeResponse, toTareTypeResponse } from './tare-type.mapper';
import { AuditService } from '../audit/audit.service';
import { assertTrimmedName } from '../common/trimmed-name';
import { diffFields } from '../common/diff-fields';
import { Paginated } from '../common/dto/paginated';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const TARE_FIELDS = ['name', 'weight_kg', 'deposit_price', 'is_crate', 'is_active'] as const;

@Injectable()
export class TareTypesService {
  constructor(
    @InjectRepository(TareType)
    private readonly repo: Repository<TareType>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListTareTypesQueryDto): Promise<Paginated<TareTypeResponse>> {
    const where: Record<string, unknown> = {};
    if (!query.include_inactive) where.is_active = true;

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { name: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return { data: data.map(toTareTypeResponse), total, page: query.page, limit: query.limit };
  }

  /**
   * Rows by id, for the intake path's §2.5 tare-weight substitution.
   *
   * ACTIVE ONLY — deactivation has to actually stop something, and this is the
   * one place the intake path can learn a tare type was retired.
   *
   * Returns fewer rows than ids asked for WITHOUT complaining: the caller knows
   * which line each id came from and turns the gap into `TARE_TYPE_UNKNOWN`
   * naming it. A seam that cannot see the request should not be guessing at an
   * error message for a caller it cannot see.
   *
   * Takes an `EntityManager` so the intake transaction reads inside itself.
   */
  async findManyRaw(ids: string[], manager?: EntityManager): Promise<TareType[]> {
    if (ids.length === 0) return [];
    const repo = manager ? manager.getRepository(TareType) : this.repo;
    return repo.find({ where: { id: In(ids), is_active: true } });
  }

  async create(actor: AuthenticatedUser, dto: CreateTareTypeDto): Promise<TareTypeResponse> {
    const name = assertTrimmedName(dto.name, 'name', 'TARE_TYPE_NAME_EMPTY');
    await this.assertNameFree(name);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(TareType);
      const willBeCrate = dto.is_crate ?? false;

      // BEFORE the insert. `UQ_tare_types_single_crate` is a bare (non-
      // deferrable) unique index — Postgres checks it at the end of THIS
      // statement, not at commit — so the insert itself would 23505 if
      // another row were still flagged when it runs. Demoting first means no
      // second flagged row ever exists, even momentarily, inside the
      // transaction. No exclusion needed: the new row doesn't exist yet.
      if (willBeCrate) {
        await this.demoteOtherCrates(manager);
      }

      const tare = await repo.save(
        repo.create({
          name,
          // Stored verbatim as strings. No arithmetic is performed on either
          // value anywhere in this module.
          weight_kg: dto.weight_kg,
          deposit_price: dto.deposit_price,
          is_crate: willBeCrate,
        }),
      );

      await this.audit.record(
        {
          action: 'tare-type.created',
          actor_id: actor.sub,
          target_type: 'tare_type',
          target_id: tare.id,
          after: {
            name: tare.name,
            weight_kg: tare.weight_kg,
            deposit_price: tare.deposit_price,
            is_crate: tare.is_crate,
          },
        },
        manager,
      );

      return toTareTypeResponse(tare);
    });
  }

  /**
   * THE DEACTIVATION RULE: deactivating a crate type with outstanding
   * deposits is a WARNING on the client, never a refusal. §6.1 and правка 14
   * — a management decision gets a warning, not a locked button, and the
   * schema's stance throughout is that a blocked button teaches people to
   * look for a way around it.
   */
  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateTareTypeDto,
  ): Promise<TareTypeResponse> {
    const tare = await this.repo.findOne({ where: { id } });
    if (!tare) throw new NotFoundException('Tare type not found');

    const before = this.snapshot(tare);

    if (dto.name != null) {
      const name = assertTrimmedName(dto.name, 'name', 'TARE_TYPE_NAME_EMPTY');
      if (name.toLowerCase() !== tare.name.toLowerCase()) {
        await this.assertNameFree(name, tare.id);
      }
      tare.name = name;
    }
    if (dto.weight_kg != null) tare.weight_kg = dto.weight_kg;
    if (dto.deposit_price != null) tare.deposit_price = dto.deposit_price;
    if (dto.is_crate != null) tare.is_crate = dto.is_crate;
    if (dto.is_active != null) tare.is_active = dto.is_active;

    return this.dataSource.transaction(async (manager) => {
      // BEFORE the save. `UQ_tare_types_single_crate` is a bare (non-
      // deferrable) unique index — Postgres checks it at the end of THIS
      // statement, not at commit — so saving `tare` with the flag on while
      // another row is still flagged would 23505 immediately, aborting the
      // transaction before the demotion line below ever ran. Demoting first
      // means no second flagged row ever exists, even momentarily, inside the
      // transaction. `tare.id` is already known (this is an update), so the
      // exclusion can run before the save that needs it.
      //
      // Gated on `dto.is_crate === true`, NOT the row's resulting value — an
      // edit that never touches the flag (e.g. a deposit-price change on the
      // row that already IS the crate) must not re-run this on every
      // unrelated PATCH.
      if (dto.is_crate === true) {
        await this.demoteOtherCrates(manager, tare.id);
      }

      const saved = await manager.getRepository(TareType).save(tare);
      const diff = diffFields(before, this.snapshot(saved), TARE_FIELDS);

      // These two numbers keep NO history of their own, and §2.7 snapshots them
      // downstream — so this entry is the only record anywhere that a crate
      // deposit went 120 → 130, and when, and who did it.
      if (diff) {
        await this.audit.record(
          {
            action: 'tare-type.updated',
            actor_id: actor.sub,
            target_type: 'tare_type',
            target_id: saved.id,
            before: diff.before,
            after: diff.after,
          },
          manager,
        );
      }

      return toTareTypeResponse(saved);
    });
  }

  /**
   * The catalogue row that IS the rented crate, or `null`.
   *
   * ACTIVE ONLY. `crate_issuances.deposit_per_unit` is snapshotted from this
   * row, so a retired crate type must stop new issuances — but it must NOT
   * stop returns, which read the frozen price off the issuance and never come
   * here.
   *
   * Takes an `EntityManager` so a caller mid-transaction (issuance/return
   * creation) reads inside itself.
   */
  async findCrateType(manager?: EntityManager): Promise<TareType | null> {
    const repo = manager ? manager.getRepository(TareType) : this.repo;
    return repo.findOne({ where: { is_crate: true, is_active: true } });
  }

  /**
   * ONE CRATE, NETWORK-WIDE (spec §5.4). Clears `is_crate` on every row except
   * `excludeId` (or every row, when creating: there is no row to exclude yet).
   *
   * MUST run before the caller's own insert/save, not after — see the two
   * call sites. `UQ_tare_types_single_crate` is a bare unique index, which
   * Postgres checks at the end of EACH statement rather than deferring to
   * commit; running this after the caller's write would let that write itself
   * collide with a still-flagged row and 23505 before this line ever executes.
   * `UQ_tare_types_single_crate` remains the backstop — if the owner ever
   * meets it, this method failed to run, not merely ran too late.
   */
  private async demoteOtherCrates(manager: EntityManager, excludeId?: string): Promise<void> {
    if (excludeId) {
      await manager.query(
        `UPDATE "tare_types" SET "is_crate" = false WHERE "is_crate" AND "id" <> $1`,
        [excludeId],
      );
    } else {
      await manager.query(`UPDATE "tare_types" SET "is_crate" = false WHERE "is_crate"`);
    }
  }

  private snapshot(tare: TareType): Record<(typeof TARE_FIELDS)[number], unknown> {
    return {
      name: tare.name,
      weight_kg: tare.weight_kg,
      deposit_price: tare.deposit_price,
      is_crate: tare.is_crate,
      is_active: tare.is_active,
    };
  }

  /** Case-insensitive, matching `UQ_tare_types_name_lower`. */
  private async assertNameFree(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repo
      .createQueryBuilder('tare')
      .where('lower(tare.name) = lower(:name)', { name })
      .getOne();

    if (existing && existing.id !== excludeId) {
      throw new ConflictException({ message: 'That name is taken', code: 'TARE_TYPE_NAME_TAKEN' });
    }
  }
}
