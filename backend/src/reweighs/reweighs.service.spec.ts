import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ReweighsService } from './reweighs.service';
import { UserRole } from '../users/user-role.enum';

// `sub`, not `id` — matches the real `AuthenticatedUser` shape
// (`auth/jwt.strategy.ts`), which every other service's `actor.sub` reads.
const owner = { sub: 'u-owner', role: UserRole.NetworkOwner, collection_point_id: null } as never;

const build = (overrides: Record<string, unknown> = {}) => {
    let lastSaved: Record<string, unknown> = {};
    const manager = {
      query: jest.fn(),
      findOne: jest.fn(),
      // Real TypeORM populates `id`/`created_at` from the DB response after an
      // insert — this mock does the same, since the mapper reads both.
      save: jest.fn(async (_e: unknown, row: Record<string, unknown>) => {
        lastSaved = {
          id: 'ri-1',
          created_at: new Date('2026-09-17T07:00:00.000Z'),
          ...row,
        };
        return lastSaved;
      }),
      // `addItem` RE-READS the saved line with its `product_grade`/`tare_type`
      // relations before mapping, so the create response carries the same
      // names the void response does. This stub echoes whatever `save`
      // produced — the relation-loading itself is proven in
      // `reweighs.db-spec.ts`, where the relations are real.
      findOneOrFail: jest.fn(async () => lastSaved),
      getRepository: jest.fn(),
      create: jest.fn((_e: unknown, row: unknown) => row),
    };
    const dataSource = { transaction: jest.fn(async (cb: never) => (cb as never as (m: unknown) => unknown)(manager)) };
    const shifts = {
      findOneRaw: jest.fn(async (): Promise<{ id: string; closed_at: null } | null> => ({
        id: 's-1',
        closed_at: null,
      })),
    };
    const tareTypes = { findManyRaw: jest.fn(async () => [{ id: 't-1', weight_kg: '1.20' }]) };
    const audit = { record: jest.fn() };
    const service = new ReweighsService(
      dataSource as never,
      shifts as never,
      tareTypes as never,
      audit as never,
    );
    Object.assign(manager, overrides);
    return { service, manager, shifts, tareTypes, audit };
  };

describe('ReweighsService.addItem', () => {
  it('subtracts the pallet first and the tare second — §8.1', async () => {
    const { service, manager } = build();
    // ensureHeader() issues two query calls (upsert, then read); then the
    // accepted-grades read; then the next-item_order read.
    manager.query
      .mockResolvedValueOnce([]) // header upsert (ON CONFLICT DO NOTHING) — no rows
      .mockResolvedValueOnce([{ id: 'rw-1' }]) // header read
      .mockResolvedValueOnce([{ product_grade_id: 'g-1' }]) // accepted grades
      .mockResolvedValueOnce([{ next: 1 }]); // next item_order

    const saved = await service.addItem(owner, 's-1', {
      product_grade_id: 'g-1',
      gross_kg: '701.50',
      pallet_kg: '18.00',
      tare: [{ tare_type_id: 't-1', units: 115 }],
    });

    expect(saved.tare_weight_kg).toBe('138.00');
    expect(saved.net_kg).toBe('545.50');
  });

  it('refuses a grade the shift did not accept — §8.1 «Чужий товар додати не можна»', async () => {
    const { service, manager } = build();
    manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'rw-1' }])
      .mockResolvedValueOnce([{ product_grade_id: 'g-OTHER' }]);

    await expect(
      service.addItem(owner, 's-1', {
        product_grade_id: 'g-1',
        gross_kg: '10.00',
        tare: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses any line on a shift that accepted nothing — §8.1', async () => {
    const { service, manager } = build();
    manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'rw-1' }])
      .mockResolvedValueOnce([]);

    await expect(
      service.addItem(owner, 's-1', { product_grade_id: 'g-1', gross_kg: '10.00', tare: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a line whose tare exceeds its gross', async () => {
    const { service, manager } = build();
    manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'rw-1' }])
      .mockResolvedValueOnce([{ product_grade_id: 'g-1' }])
      .mockResolvedValueOnce([{ next: 1 }]);

    await expect(
      service.addItem(owner, 's-1', {
        product_grade_id: 'g-1',
        gross_kg: '100.00',
        pallet_kg: '18.00',
        tare: [{ tare_type_id: 't-1', units: 115 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s an unknown shift', async () => {
    const { service, shifts } = build();
    shifts.findOneRaw.mockResolvedValueOnce(null);
    await expect(
      service.addItem(owner, 's-nope', { product_grade_id: 'g-1', gross_kg: '1.00', tare: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('writes a line against an OPEN shift — spec §3.9, no status gate', async () => {
    const { service, manager, shifts } = build();
    shifts.findOneRaw.mockResolvedValueOnce({ id: 's-1', closed_at: null });
    manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'rw-1' }])
      .mockResolvedValueOnce([{ product_grade_id: 'g-1' }])
      .mockResolvedValueOnce([{ next: 3 }]);

    const saved = await service.addItem(owner, 's-1', {
      product_grade_id: 'g-1',
      gross_kg: '10.00',
      tare: [],
    });
    expect(saved.item_order).toBe(3);
  });
});

describe('ReweighsService.voidItem', () => {
  it('stamps the trio and keeps the row — §8.7', async () => {
    const { service, manager, audit } = build();
    manager.findOne = jest.fn(async () => ({
      id: 'i-1',
      reweigh_id: 'rw-1',
      item_order: 1,
      voided_at: null,
      created_at: new Date(),
      net_kg: '545.50',
      gross_kg: '701.50',
      pallet_kg: '18.00',
      tare_weight_kg: '138.00',
      product_grade_id: 'g-1',
      weighed_by_user_id: 'u-owner',
      voided_by_user_id: null,
      void_reason: null,
    }));

    const out = await service.voidItem(owner, 'i-1', { reason: 'переважили не ту партію' });

    expect(out.voided_at).not.toBeNull();
    expect(out.void_reason).toBe('переважили не ту партію');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reweigh-item.voided' }),
      expect.anything(),
    );
  });

  it('refuses to void twice', async () => {
    const { service, manager } = build();
    manager.findOne = jest.fn(async () => ({ id: 'i-1', voided_at: new Date() }));
    await expect(service.voidItem(owner, 'i-1', { reason: 'ще раз' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404s an unknown line', async () => {
    const { service, manager } = build();
    manager.findOne = jest.fn(async () => null);
    await expect(service.voidItem(owner, 'nope', { reason: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
