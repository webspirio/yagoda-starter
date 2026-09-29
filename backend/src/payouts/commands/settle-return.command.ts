import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SettleReturnDto } from '../dto/settle-return.dto';
import { PayoutResponse, toPayoutResponse } from '../payout.mapper';
import { PayoutWriter } from '../services/payout-writer';
import { LoadVisiblePayoutQuery } from '../queries/load-visible-payout.query';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * Owner-only: whoever holds the drawer must not attest its refill (§9.3). Always the whole
 * payout. Under the row lock — two differently-attributed records of one attestation are
 * exactly the ambiguity §9.3 is about. Touches no allocation, so no ledger.
 */
@Injectable()
export class SettleReturnCommand {
  constructor(
    private readonly dataSource: DataSource,
    private readonly visible: LoadVisiblePayoutQuery,
    private readonly writer: PayoutWriter,
  ) {}

  async settle(
    actor: AuthenticatedUser,
    id: string,
    dto: SettleReturnDto,
  ): Promise<PayoutResponse> {
    if (actor.role !== UserRole.NetworkOwner) {
      throw new ForbiddenException({
        message: 'Only the network owner may record a returned payout',
        code: 'OWNER_ONLY',
      });
    }

    return this.dataSource.transaction(async (m) => {
      const { payout, shift } = await this.visible.load(actor, id, m);
      if (!payout.voided_at) {
        throw new ConflictException({
          message: 'Only a voided payout can have its cash returned',
          code: 'PAYOUT_NOT_VOIDED',
        });
      }
      if (payout.return_settled_at) {
        throw new ConflictException({
          message: 'That payout’s cash has already been recorded as returned',
          code: 'RETURN_ALREADY_SETTLED',
        });
      }
      return toPayoutResponse(
        await this.writer.settleReturn(m, actor, payout, dto.note ?? null),
        shift,
      );
    });
  }
}
