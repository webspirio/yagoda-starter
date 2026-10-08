import { UpdateNetworkSettingsCommand } from './update-network-settings.command';
import { NetworkSettings } from '../network-settings.entity';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

const OWNER = {
  sub: 'owner-1',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
} as AuthenticatedUser;
const AT = new Date('2026-10-08T09:00:00.000Z');

describe('UpdateNetworkSettingsCommand', () => {
  let command: UpdateNetworkSettingsCommand;
  let manager: { findOneOrFail: jest.Mock; save: jest.Mock };
  let audit: { record: jest.Mock };

  const row = (receipt_note: string | null): NetworkSettings =>
    ({ id: true, receipt_note, updated_at: AT }) as NetworkSettings;

  beforeEach(() => {
    manager = {
      findOneOrFail: jest.fn().mockResolvedValue(row('стара')),
      save: jest.fn().mockImplementation((_e, r: NetworkSettings) => ({ ...r, updated_at: AT })),
    };
    audit = { record: jest.fn() };
    const dataSource = { transaction: jest.fn((fn: (m: unknown) => unknown) => fn(manager)) };
    command = new UpdateNetworkSettingsCommand(dataSource as never, audit as never);
  });

  it('reads the row under a write lock', async () => {
    await command.update(OWNER, { receipt_note: 'нова' });
    expect(manager.findOneOrFail).toHaveBeenCalledWith(NetworkSettings, {
      where: { id: true },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('saves a changed note and audits before and after in the same transaction', async () => {
    const result = await command.update(OWNER, { receipt_note: 'нова' });

    expect(result).toEqual({ receipt_note: 'нова', updated_at: AT.toISOString() });
    expect(manager.save).toHaveBeenCalledWith(
      NetworkSettings,
      expect.objectContaining({ receipt_note: 'нова' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      {
        action: 'network-settings.updated',
        actor_id: 'owner-1',
        target_type: 'network_settings',
        target_id: null,
        before: { receipt_note: 'стара' },
        after: { receipt_note: 'нова' },
      },
      manager,
    );
  });

  it('writes nothing when the note did not change', async () => {
    const result = await command.update(OWNER, { receipt_note: 'стара' });
    expect(result.receipt_note).toBe('стара');
    expect(manager.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('treats whitespace as clearing, and an empty row as unchanged by it', async () => {
    manager.findOneOrFail.mockResolvedValue(row(null));
    await command.update(OWNER, { receipt_note: '   ' });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('clears the note with null', async () => {
    await command.update(OWNER, { receipt_note: null });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ before: { receipt_note: 'стара' }, after: { receipt_note: null } }),
      manager,
    );
  });

  it('leaves the note alone when the body omits it', async () => {
    await command.update(OWNER, {});
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('refuses a note that does not fit, before saving', async () => {
    await expect(command.update(OWNER, { receipt_note: 'x'.repeat(41) })).rejects.toMatchObject({
      response: { code: 'RECEIPT_NOTE_TOO_LONG' },
    });
    expect(manager.save).not.toHaveBeenCalled();
  });
});
