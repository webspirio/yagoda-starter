import { Test, TestingModule } from '@nestjs/testing';
import {
  HealthCheckService,
  HealthIndicatorFunction,
  HealthIndicatorService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { REDIS_CLIENT } from '../redis/redis.module';
import { appConfig } from '../config/app.config';

// Runs the indicator functions like terminus would, merging their results.
const mockCheck = jest.fn(async (indicators: HealthIndicatorFunction[]) => {
  const details: Record<string, unknown> = {};
  for (const indicator of indicators) Object.assign(details, await indicator());
  return { status: 'ok', details };
});
const mockPingCheck = jest.fn().mockResolvedValue({ database: { status: 'up' } });
const mockRedisPing = jest.fn().mockResolvedValue('PONG');

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthIndicatorService,
        { provide: HealthCheckService, useValue: { check: mockCheck } },
        { provide: TypeOrmHealthIndicator, useValue: { pingCheck: mockPingCheck } },
        { provide: REDIS_CLIENT, useValue: { ping: mockRedisPing } },
        { provide: appConfig.KEY, useValue: { commit: 'abc123def' } },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('GET /health/live checks nothing beyond the process being up', async () => {
    const result = await controller.live();
    expect(mockCheck).toHaveBeenCalledWith([]);
    expect(result.status).toBe('ok');
    expect(mockPingCheck).not.toHaveBeenCalled();
    expect(mockRedisPing).not.toHaveBeenCalled();
  });

  it('GET /health/ready pings database and redis', async () => {
    const result = await controller.ready();
    expect(mockPingCheck).toHaveBeenCalledWith('database');
    expect(mockRedisPing).toHaveBeenCalled();
    expect(result.details).toEqual({
      database: { status: 'up' },
      redis: { status: 'up' },
    });
  });

  it('reports redis as down when the ping fails', async () => {
    mockRedisPing.mockRejectedValueOnce(new Error('connection refused'));
    const result = await controller.ready();
    expect(result.details).toEqual({
      database: { status: 'up' },
      redis: { status: 'down', message: 'connection refused' },
    });
  });

  it('GET /health/version reports the commit the image was built from', () => {
    expect(controller.version()).toEqual({ commit: 'abc123def' });
  });
});
