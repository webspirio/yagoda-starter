import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NetworkSettings } from '../network-settings.entity';
import { UpdateNetworkSettingsDto } from '../dto/update-network-settings.dto';
import { NetworkSettingsResponse, toNetworkSettingsResponse } from '../network-settings.mapper';
import { canonicalReceiptNote } from '../receipt-note';
import { AuditService } from '../../audit/audit.service';
import { diffFields } from '../../common/diff-fields';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class UpdateNetworkSettingsCommand {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async update(
    actor: AuthenticatedUser,
    dto: UpdateNetworkSettingsDto,
  ): Promise<NetworkSettingsResponse> {
    return this.dataSource.transaction(async (m) => {
      // Locked, so two owners saving at once each diff against the other's write.
      const before = await m.findOneOrFail(NetworkSettings, {
        where: { id: true },
        lock: { mode: 'pessimistic_write' },
      });
      const next = { ...before };
      if (dto.receipt_note !== undefined) {
        next.receipt_note = canonicalReceiptNote(dto.receipt_note);
      }

      const diff = diffFields(before, next, ['receipt_note']);
      if (!diff) return toNetworkSettingsResponse(before);

      const saved = await m.save(NetworkSettings, next);
      await this.audit.record(
        {
          action: 'network-settings.updated',
          actor_id: actor.sub,
          // One row with a boolean key; `target_id` is a uuid column, so it stays null.
          target_type: 'network_settings',
          target_id: null,
          before: diff.before,
          after: diff.after,
        },
        m,
      );
      return toNetworkSettingsResponse(saved);
    });
  }
}
