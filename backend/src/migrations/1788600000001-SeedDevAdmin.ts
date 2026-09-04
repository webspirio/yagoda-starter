import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Development convenience: one account so a fresh database is usable
 * immediately (username `admin`, password `admin`).
 *
 * Guarded on NODE_ENV so it can never create a known-credential account in
 * production. The guard is inside up(), not around the file, because the
 * migrations table must record the same list of applied migrations in every
 * environment — skipping the file entirely in production would leave prod and
 * dev with divergent migration histories.
 */
export class SeedDevAdmin1788600000001 implements MigrationInterface {
  name = 'SeedDevAdmin1788600000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (process.env.NODE_ENV === 'production') return;

    const [user] = await queryRunner.query(`
      INSERT INTO "users" ("display_name", "is_active")
      VALUES ('Dev Admin', true)
      RETURNING "id"
    `);

    await queryRunner.query(
      `INSERT INTO "user_identities" ("provider", "provider_user_id", "user_id")
       VALUES ('local', 'admin', $1)`,
      [user.id],
    );

    // ⚠️ Plain text, matching CredentialsService. Dev only — see the guard above.
    await queryRunner.query(
      `INSERT INTO "user_credentials" ("user_id", "password") VALUES ($1, 'admin')`,
      [user.id],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "users" WHERE "id" IN (
         SELECT "user_id" FROM "user_identities"
         WHERE "provider" = 'local' AND "provider_user_id" = 'admin'
       )`,
    );
  }
}
