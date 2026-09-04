import { MigrationInterface, QueryRunner } from 'typeorm';
import { hashPassword } from '../users/password-hashing';

/**
 * Creates the first network_owner from the environment, so a fresh production
 * database is reachable at all: public registration is gone, and only an owner
 * can create accounts.
 *
 * NO-OPS unless the users table is EMPTY. It will therefore not fire in
 * development (SeedDevAdmin already ran) and cannot overwrite anything.
 *
 * ⚠️ KNOWN SHARP EDGE, ACCEPTED: a migration runs once. If a production
 * database is first booted WITHOUT these variables set, this records itself as
 * applied and no owner is ever created — recovery is a manual INSERT. Set
 * BOOTSTRAP_OWNER_LOGIN and BOOTSTRAP_OWNER_PASSWORD before the first boot.
 * A boot-time idempotent bootstrap would not have this property; it was
 * decided as a migration deliberately, and the trade-off is named rather than
 * discovered.
 */
export class BootstrapOwner1788600000003 implements MigrationInterface {
  name = 'BootstrapOwner1788600000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const login = process.env.BOOTSTRAP_OWNER_LOGIN?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
    if (!login || !password) return;

    const [{ count }] = await queryRunner.query(`SELECT count(*)::int AS count FROM "users"`);
    if (count > 0) return;

    const firstName = process.env.BOOTSTRAP_OWNER_FIRST_NAME?.trim() || 'Network';
    const lastName = process.env.BOOTSTRAP_OWNER_LAST_NAME?.trim() || 'Owner';

    const [user] = await queryRunner.query(
      `INSERT INTO "users" ("first_name", "last_name", "role", "is_active")
       VALUES ($1, $2, 'network_owner', true) RETURNING "id"`,
      [firstName, lastName],
    );
    await queryRunner.query(
      `INSERT INTO "user_identities" ("provider", "provider_user_id", "user_id")
       VALUES ('local', $1, $2)`,
      [login, user.id],
    );
    await queryRunner.query(
      `INSERT INTO "user_credentials" ("user_id", "password_hash") VALUES ($1, $2)`,
      [user.id, await hashPassword(password)],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const login = process.env.BOOTSTRAP_OWNER_LOGIN?.trim().toLowerCase();
    if (!login) return;
    await queryRunner.query(
      `DELETE FROM "users" WHERE "id" IN (
         SELECT "user_id" FROM "user_identities"
         WHERE "provider" = 'local' AND "provider_user_id" = $1
       )`,
      [login],
    );
  }
}
