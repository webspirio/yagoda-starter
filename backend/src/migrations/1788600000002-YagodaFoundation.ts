import { MigrationInterface, QueryRunner } from 'typeorm';
import { hashPassword } from '../users/password-hashing';

/**
 * The Yagoda CRM foundation: collection points, roles, and real password
 * hashing.
 *
 * `SeedDevAdmin` (…0001) is deliberately NOT amended to write the new columns:
 * it runs BEFORE this migration, so a version referencing `first_name` or
 * `role` would fail on every fresh database. It keeps writing `display_name`
 * against the old schema and this migration carries its row forward — which
 * also covers existing dev databases, where an amended file would never
 * re-run anyway.
 *
 * Importing `hashPassword` from application code is normally something a
 * migration should not do, because a later change to that module changes what
 * this frozen migration means. It is safe HERE precisely because the stored
 * format is self-describing: whatever parameters this produces today stay
 * verifiable forever, even after the defaults are raised.
 */
export class YagodaFoundation1788600000002 implements MigrationInterface {
  name = 'YagodaFoundation1788600000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."user_role" AS ENUM('network_owner', 'point_operator')`,
    );
    await queryRunner.query(`CREATE TYPE "public"."point_kind" AS ENUM('reception', 'base')`);

    // target_cash / target_crates are NULLABLE WITH NO DEFAULT on purpose —
    // §6.9 wants "—" rather than 0 for a point with no target, and §7.10 wants
    // such a point excluded from the network-debt table entirely. A default of
    // 0 would break both. See CollectionPoint's doc comment.
    await queryRunner.query(`
      CREATE TABLE "collection_points" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "kind" "public"."point_kind" NOT NULL DEFAULT 'reception',
        "target_cash" numeric(12,2),
        "target_crates" integer,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_collection_points" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_collection_points_name" UNIQUE ("name"),
        CONSTRAINT "CHK_collection_points_target_cash"
          CHECK ("target_cash" IS NULL OR "target_cash" >= 0),
        CONSTRAINT "CHK_collection_points_target_crates"
          CHECK ("target_crates" IS NULL OR "target_crates" >= 0)
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "first_name" character varying,
        ADD COLUMN "last_name" character varying,
        ADD COLUMN "role" "public"."user_role",
        ADD COLUMN "collection_point_id" uuid
    `);

    // Backfill. In practice this touches only the dev-seeded admin: production
    // has no users before this migration, because public registration is gone
    // and the bootstrap owner is created by the NEXT migration.
    await queryRunner.query(`
      UPDATE "users" SET
        "first_name" = COALESCE(NULLIF(split_part(COALESCE("display_name", ''), ' ', 1), ''), 'User'),
        "last_name"  = CASE
                         WHEN COALESCE("display_name", '') LIKE '% %'
                           THEN substr("display_name", strpos("display_name", ' ') + 1)
                         ELSE '—'
                       END,
        "role" = 'network_owner'
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "first_name" SET NOT NULL,
        ALTER COLUMN "last_name" SET NOT NULL,
        ALTER COLUMN "role" SET NOT NULL,
        DROP COLUMN "display_name"
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "FK_users_collection_point"
        FOREIGN KEY ("collection_point_id") REFERENCES "collection_points"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    // An operator with no point would make every downstream scoping assertion
    // scope to nothing, silently; an owner pinned to a point contradicts §10.1.
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "CHK_users_role_point" CHECK (
          ("role" = 'point_operator' AND "collection_point_id" IS NOT NULL)
          OR ("role" = 'network_owner' AND "collection_point_id" IS NULL)
        )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_users_collection_point" ON "users" ("collection_point_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "user_credentials" RENAME COLUMN "password" TO "password_hash"`,
    );

    // Convert every plain-text value left by the starter (and by SeedDevAdmin)
    // into a real scrypt verifier. Row by row because each needs its own salt.
    const rows: { user_id: string; password_hash: string }[] = await queryRunner.query(
      `SELECT "user_id", "password_hash" FROM "user_credentials"`,
    );
    for (const row of rows) {
      await queryRunner.query(`UPDATE "user_credentials" SET "password_hash" = $1 WHERE "user_id" = $2`, [
        await hashPassword(row.password_hash),
        row.user_id,
      ]);
    }

    // The starter created these as bare `timestamp`, while audit_log and
    // media_files already use `timestamptz`. One convention from here on: the
    // stored values came from now() on a UTC container, so interpreting them
    // as UTC is correct rather than merely convenient.
    for (const table of ['users', 'user_identities']) {
      for (const column of ['created_at', 'updated_at']) {
        await queryRunner.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TIMESTAMP WITH TIME ZONE
             USING "${column}" AT TIME ZONE 'UTC'`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['users', 'user_identities']) {
      for (const column of ['created_at', 'updated_at']) {
        await queryRunner.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TIMESTAMP
             USING "${column}" AT TIME ZONE 'UTC'`,
        );
      }
    }

    // Irreversible in substance: the plain-text passwords are gone for good.
    // Reverting leaves scrypt strings in a column named `password`, so every
    // login fails until credentials are reset. Named, not hidden.
    await queryRunner.query(
      `ALTER TABLE "user_credentials" RENAME COLUMN "password_hash" TO "password"`,
    );

    await queryRunner.query(`DROP INDEX "public"."IDX_users_collection_point"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role_point"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_collection_point"`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "display_name" character varying`);
    await queryRunner.query(
      `UPDATE "users" SET "display_name" = btrim("first_name" || ' ' || "last_name")`,
    );
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "collection_point_id",
        DROP COLUMN "role",
        DROP COLUMN "last_name",
        DROP COLUMN "first_name"
    `);

    await queryRunner.query(`DROP TABLE "collection_points"`);
    await queryRunner.query(`DROP TYPE "public"."point_kind"`);
    await queryRunner.query(`DROP TYPE "public"."user_role"`);
  }
}
