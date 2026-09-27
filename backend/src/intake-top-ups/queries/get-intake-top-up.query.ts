import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntakeTopUp } from '../intake-top-up.entity';
import { IntakeTopUpResponse } from '../intake-top-up.mapper';
import { RawTopUpRow, toTopUpResponse, topUpRows } from './intake-top-up-rows';
import { resolvePointFilter } from '../../auth/access/point-scope';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/** Another point's top-up is a 404, never a 403: a supplier's name and a money amount. */
@Injectable()
export class GetIntakeTopUpQuery {
  constructor(@InjectRepository(IntakeTopUp) private readonly repo: Repository<IntakeTopUp>) {}

  async get(actor: AuthenticatedUser, id: string): Promise<IntakeTopUpResponse> {
    const row = await topUpRows(this.repo, resolvePointFilter(actor))
      .andWhere('t.id = :id', { id })
      .getRawOne<RawTopUpRow>();
    if (!row) throw new NotFoundException('Intake top-up not found');
    return toTopUpResponse(row);
  }
}
