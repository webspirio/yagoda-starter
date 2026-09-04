import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JwtStrategy.validate() now calls UsersService.findAuthContext on EVERY
 * authenticated request, which queries user_identities filtered by
 * (provider, user_id). The existing UNIQUE index covers (provider,
 * provider_user_id) — the login lookup — not this one, so the per-request
 * "ONE INDEXED LOOKUP" the strategy's own comment promises was actually a
 * sequential scan. This index is what makes that comment true.
 */
export class IndexUserIdentityUser1788600000004 implements MigrationInterface {
  name = 'IndexUserIdentityUser1788600000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_user_identities_user" ON "user_identities" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_user_identities_user"`);
  }
}
