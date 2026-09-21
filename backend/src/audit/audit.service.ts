import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditAction, AuditLog } from './audit-log.entity';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Paginated } from '../common/dto/paginated';

export interface RecordAuditEntry {
  action: AuditAction;
  actor_id: string;
  target_type?: string | null;
  target_id?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  note?: string | null;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /**
   * Append one entry. `insert` rather than `save`, because this table is
   * append-only and `save` would happily update an existing row.
   *
   * Accepts an EntityManager so an audit entry commits atomically with the
   * change it describes — an entry recording a write that then rolled back is
   * worse than no entry at all.
   */
  async record(entry: RecordAuditEntry, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLog) : this.repo;
    await repo.insert({
      action: entry.action,
      actor_id: entry.actor_id,
      target_type: entry.target_type ?? null,
      target_id: entry.target_id ?? null,
      // The casts are confined to the two jsonb columns and are unavoidable:
      // TypeORM's QueryDeepPartialEntity<T> recurses into `Record<string,
      // unknown>` and cannot accept a plain object for a jsonb field. Casting
      // the WHOLE payload instead would also suppress key checking on
      // `action`, `actor_id`, `target_type`, `target_id` and `note` — and this
      // object literal is the one place those keys must match the entity's
      // columns, so a typo has to stay a compile error.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- QueryDeepPartialEntity rejects a plain object for the jsonb `before` column; casting only this field keeps its siblings key-checked
      before: (entry.before ?? null) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same jsonb cast for the `after` column, scoped to one field for the same reason
      after: (entry.after ?? null) as any,
      note: entry.note ?? null,
    });
  }

  async list({ page, limit }: PaginationQueryDto): Promise<Paginated<AuditLog>> {
    const [data, total] = await this.repo.findAndCount({
      order: { at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }
}
