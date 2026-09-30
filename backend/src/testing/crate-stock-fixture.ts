import { randomUUID } from 'crypto';
// `export = supertest` and no `esModuleInterop`: a default import type-checks, then is `undefined` at runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- same CJS workaround as the db-specs, which lint ignores
import request = require('supertest');
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
// MUST precede `../app.module` — see crates-race.db-spec.ts.
import { relaxThrottleForTests, resolveTestDatabaseName } from './db-harness';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { UserRole } from '../users/user-role.enum';
import { onHandSql } from '../crates/crate-balance.service';

/** Crates on-hand invariant (spec 2026-09-30): every spec that issues crates, closes with
 *  breakage or weighs crate tare now needs empties at the point first. */
const code = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

export async function bootApp(): Promise<{ app: INestApplication; ds: DataSource; ownerToken: string }> {
  process.env.DB_NAME = resolveTestDatabaseName();
  relaxThrottleForTests();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.init();
  const { user: owner } = await app.get(UsersService).createWithIdentity(
    {
      provider: LOCAL_PROVIDER,
      providerUserId: `stock-owner-${randomUUID()}`,
      first_name: 'Stock',
      last_name: 'Owner',
      role: UserRole.NetworkOwner,
    },
    async (created, manager) => app.get(CredentialsService).set(created.id, 'hunter2!!', manager),
  );
  const ownerToken = app.get(JwtService).sign({ sub: owner.id });
  // Exactly one crate type must exist (`NO_CRATE_TYPE` otherwise); creating one demotes others.
  await request(app.getHttpServer())
    .post('/tare-types')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: `stock-crate-${randomUUID()}`, weight_kg: '1.20', deposit_price: '120.00', is_crate: true })
    .expect(201);
  return { app, ds: app.get(DataSource), ownerToken };
}

export async function makePoint(
  a: INestApplication,
  ownerToken: string,
  label: string,
): Promise<{ pointId: string; operatorToken: string }> {
  const p = await request(a.getHttpServer())
    .post('/collection-points')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: `${label}-${randomUUID()}`, code: code() })
    .expect(201);
  const pointId = p.body.id as string;
  const { user: op } = await a.get(UsersService).createWithIdentity(
    {
      provider: LOCAL_PROVIDER,
      providerUserId: `${label}-op-${randomUUID()}`,
      first_name: 'Stock',
      last_name: 'Operator',
      role: UserRole.PointOperator,
      collection_point_id: pointId,
    },
    async (created, manager) => a.get(CredentialsService).set(created.id, 'hunter2!!', manager),
  );
  const operatorToken = a.get(JwtService).sign({ sub: op.id });
  await request(a.getHttpServer())
    .post('/shifts')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ counted_amount: '0.00' })
    .expect(201);
  return { pointId, operatorToken };
}

export async function makeSupplier(a: INestApplication, operatorToken: string): Promise<string> {
  const s = await request(a.getHttpServer())
    .post('/suppliers')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ first_name: 'Stock', last_name: `Supplier-${randomUUID()}` })
    .expect(201);
  return s.body.id as string;
}

export async function sendCrates(a: INestApplication, ownerToken: string, pointId: string, crates: number): Promise<string> {
  const t = await request(a.getHttpServer())
    .post('/transfers')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ collection_point_id: pointId, cash: '0.00', crates, carrier: 'Водій' })
    .expect(201);
  return t.body.id as string;
}

export async function stockPoint(
  a: INestApplication,
  ownerToken: string,
  operatorToken: string,
  pointId: string,
  crates: number,
): Promise<string> {
  const id = await sendCrates(a, ownerToken, pointId, crates);
  await request(a.getHttpServer())
    .post(`/transfers/${id}/accept`)
    .set('Authorization', `Bearer ${operatorToken}`)
    .expect(201);
  return id;
}

export async function onHand(ds: DataSource, pointId: string): Promise<number> {
  const [row] = (await ds.query(`SELECT ${onHandSql('$1')} AS n`, [pointId])) as { n: number }[];
  return row.n;
}
