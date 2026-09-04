import { ArgumentsHost, ConflictException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

// Hand-rolled ArgumentsHost/response mocks (no NestJS TestingModule) — the
// filter is pure request/response plumbing, so a unit spec is enough; the
// pipeline specs exercise it end-to-end through supertest.
describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let json: jest.Mock;
  let status: jest.Mock;

  const host = () =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ url: '/widgets/w1', id: 'req-1' }),
        getResponse: () => ({ status, json }),
      }),
    }) as unknown as ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    json = jest.fn();
    status = jest.fn().mockReturnValue({ status, json });
  });

  it('keeps the standard envelope for a plain HttpException', () => {
    filter.catch(new NotFoundException('Widget not found'), host());
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        error: 'Not Found',
        message: 'Widget not found',
        path: '/widgets/w1',
        requestId: 'req-1',
      }),
    );
    expect(json.mock.calls[0][0]).not.toHaveProperty('code');
  });

  it('passes code + extra fields through for an object-bodied HttpException', () => {
    filter.catch(
      new ConflictException({
        code: 'CAPACITY_BELOW_OCCUPIED',
        occupied: 7,
        message: 'Capacity below occupied seats',
      }),
      host(),
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        code: 'CAPACITY_BELOW_OCCUPIED',
        occupied: 7,
        message: 'Capacity below occupied seats',
      }),
    );
  });

  it('envelope keys always win over same-named extras', () => {
    filter.catch(
      new ConflictException({
        code: 'AUDIENCE_NARROWING',
        affectedCount: 3,
        path: '/spoofed', // must NOT override the real request path
        message: 'msg',
      }),
      host(),
    );
    const body = json.mock.calls[0][0] as Record<string, unknown>;
    expect(body.path).toBe('/widgets/w1');
    expect(body.code).toBe('AUDIENCE_NARROWING');
    expect(body.affectedCount).toBe(3);
  });

  it('unknown errors respond with a generic 500 and no leaked internals', () => {
    filter.catch(new Error('db password is hunter2'), host());
    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0] as Record<string, unknown>;
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
