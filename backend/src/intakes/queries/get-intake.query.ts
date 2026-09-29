import { Injectable } from '@nestjs/common';
import { LoadVisibleIntakeQuery } from './load-visible-intake.query';
import { IntakeDetailQuery } from './intake-detail.query';
import { IntakeDetailResponse } from '../intake.mapper';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class GetIntakeQuery {
  constructor(
    private readonly visible: LoadVisibleIntakeQuery,
    private readonly detail: IntakeDetailQuery,
  ) {}

  async get(actor: AuthenticatedUser, id: string): Promise<IntakeDetailResponse> {
    const { intake, shift } = await this.visible.load(actor, id);
    return this.detail.forIntake(intake, shift);
  }
}
