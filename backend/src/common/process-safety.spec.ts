import { LoggerService } from '@nestjs/common';
import { installUnhandledRejectionHandler } from './process-safety';

describe('installUnhandledRejectionHandler', () => {
  let logger: { error: jest.Mock };
  let saved: NodeJS.UnhandledRejectionListener[];

  beforeEach(() => {
    saved = process.listeners('unhandledRejection');
    process.removeAllListeners('unhandledRejection');
    logger = { error: jest.fn() };
  });

  afterEach(() => {
    process.removeAllListeners('unhandledRejection');
    for (const listener of saved) process.on('unhandledRejection', listener);
  });

  const emit = (reason: unknown) =>
    process.emit('unhandledRejection', reason, Promise.resolve());

  it('logs an Error’s message and stack, and does not rethrow', () => {
    installUnhandledRejectionHandler(logger as unknown as LoggerService);
    const err = new Error('connection terminated');

    expect(() => emit(err)).not.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      'unhandled promise rejection: connection terminated',
      err.stack,
      'ProcessSafety',
    );
  });

  it('logs a non-Error rejection with no stack', () => {
    installUnhandledRejectionHandler(logger as unknown as LoggerService);

    emit('weird');

    expect(logger.error).toHaveBeenCalledWith(
      'unhandled promise rejection: weird',
      undefined,
      'ProcessSafety',
    );
  });

  it('leaves the process alive — the handler is the whole point', () => {
    installUnhandledRejectionHandler(logger as unknown as LoggerService);
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    emit(new Error('boom'));

    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });
});
