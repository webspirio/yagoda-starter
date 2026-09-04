import { Logger } from '@nestjs/common';
import { runGuardedTick } from './guarded-tick';
import { messageOf } from '../errors/message-of';

describe('runGuardedTick', () => {
  let logger: { warn: jest.Mock };

  beforeEach(() => {
    logger = { warn: jest.fn() };
  });

  it('runs the tick body and logs nothing on success', async () => {
    const run = jest.fn().mockResolvedValue(undefined);

    await expect(
      runGuardedTick(logger as unknown as Logger, 'cleanup scheduler', run),
    ).resolves.toBeUndefined();

    expect(run).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('swallows a rejection and logs it against the named tick', async () => {
    const run = jest.fn().mockRejectedValue(new Error('connection terminated'));

    await expect(
      runGuardedTick(logger as unknown as Logger, 'delivery', run),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith('delivery tick failed: connection terminated');
  });

  it('survives a non-Error throw rather than losing the tick', async () => {
    const run = jest.fn().mockRejectedValue('weird');

    await runGuardedTick(logger as unknown as Logger, 'digest scheduler', run);

    expect(logger.warn).toHaveBeenCalledWith('digest scheduler tick failed: weird');
  });
});

describe('messageOf', () => {
  it("takes an Error's message", () => {
    expect(messageOf(new Error('boom'))).toBe('boom');
  });

  it('stringifies anything else', () => {
    expect(messageOf(42)).toBe('42');
    expect(messageOf(undefined)).toBe('undefined');
  });
});
