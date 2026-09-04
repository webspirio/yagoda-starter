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
      before: entry.before ?? null,
      after: entry.after ?? null,
      note: entry.note ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
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
