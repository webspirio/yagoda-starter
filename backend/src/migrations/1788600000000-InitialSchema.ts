import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1788600000000 implements MigrationInterface {
  name = 'InitialSchema1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "display_name" character varying,
        "avatar_url" character varying,
        "language_code" character varying,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    // "user_id", not "userId": UserIdentity's @ManyToOne carries an explicit
    // @JoinColumn({ name: 'user_id' }) precisely so this schema stays
    // all-snake_case. Using the naming-strategy default here would leave the
    // DDL and the entity metadata pointing at two different columns.
    await queryRunner.query(`
      CREATE TABLE "user_identities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider" character varying NOT NULL,
        "provider_user_id" character varying NOT NULL,
        "provider_data" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "user_id" uuid,
        CONSTRAINT "UQ_user_identities_provider" UNIQUE ("provider", "provider_user_id"),
        CONSTRAINT "PK_user_identities" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "user_identities"
        ADD CONSTRAINT "FK_user_identities_user"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // ⚠️ `password` holds a PLAIN TEXT password. Deliberate starter placeholder —
    // see UserCredentials and CredentialsService. Replace with a KDF-derived
    // value (salt:hash) before any real deployment.
    await queryRunner.query(`
      CREATE TABLE "user_credentials" (
        "user_id" uuid NOT NULL,
        "password" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_credentials" PRIMARY KEY ("user_id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "user_credentials"
        ADD CONSTRAINT "FK_user_credentials_user"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE TABLE "audit_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "action" character varying NOT NULL,
        "actor_id" uuid NOT NULL,
        "target_type" character varying,
        "target_id" uuid,
        "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "before" jsonb,
        "after" jsonb,
        "note" text,
        CONSTRAINT "PK_audit_log" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "audit_log"
        ADD CONSTRAINT "FK_audit_log_actor"
        FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_log_target_at" ON "audit_log" ("target_type", "target_id", "at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_log_actor_at" ON "audit_log" ("actor_id", "at")`,
    );

    await queryRunner.query(`CREATE TYPE "public"."media_purpose" AS ENUM('avatar')`);
    await queryRunner.query(`
      CREATE TABLE "media_files" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "storage_key" character varying NOT NULL,
        "url" character varying NOT NULL,
        "kind" character varying NOT NULL,
        "size_bytes" integer NOT NULL,
        "purpose" "public"."media_purpose" NOT NULL,
        "uploaded_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_media_files_storage_key" UNIQUE ("storage_key"),
        CONSTRAINT "PK_media_files" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "media_files"`);
    await queryRunner.query(`DROP TYPE "public"."media_purpose"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_log_actor_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_log_target_at"`);
    await queryRunner.query(`DROP TABLE "audit_log"`);
    await queryRunner.query(`DROP TABLE "user_credentials"`);
    await queryRunner.query(`DROP TABLE "user_identities"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
