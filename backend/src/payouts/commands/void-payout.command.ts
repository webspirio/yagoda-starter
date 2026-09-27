import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Payout } from '../payout.entity';
import { PayoutResponse, toPayoutResponse } from '../payout.mapper';
import { PayoutWriter } from '../services/payout-writer';
import { LoadVisiblePayoutQuery } from '../queries/load-visible-payout.query';
import { VoidDocumentDto } from '../../intakes/dto/void-document.dto';
import { AllocationsService } from '../../supplier-balance/services/allocations';
import { assertCanVoid } from '../../auth/access/document-access';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/** §9.4 void. Load and state check under the row lock, or a double tap audits twice. */
@Injectable()
export class VoidPayoutCommand {
  constructor(
    private readonly dataSource: DataSource,
    private readonly allocations: AllocationsService,
    private readonly visible: LoadVisiblePayoutQuery,
    private readonly writer: PayoutWriter,
  ) {}

  async void(actor: AuthenticatedUser, id: string, dto: VoidDocumentDto): Promise<PayoutResponse> {
    return this.dataSource.transaction(async (m) => {
      // Unlocked stub: a missing id 404s before any lock; then the supplier lock, always first.
      const stub = await m.findOne(Payout, { where: { id } });
      if (!stub) throw new NotFoundException('Payout not found');

      return this.allocations.withinSupplierLedger(m, stub.supplier_id, async () => {
        const { payout, shift } = await this.visible.load(actor, id, m);
        assertCanVoid(
          actor,
          { authorId: payout.paid_by_user_id, shift },
          'That shift is closed — ask the network owner',
        );
        if (payout.voided_at) {
          throw new ConflictException({
            message: 'That payout is already voided',
            code: 'ALREADY_VOIDED',
          });
        }
        return toPayoutResponse(await this.writer.void(m, actor, payout, dto.reason), shift);
      });
    });
  }
}
