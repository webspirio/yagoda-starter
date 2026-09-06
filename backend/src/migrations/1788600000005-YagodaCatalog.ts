import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Yagoda catalogs: products, their grades, and tare types.
 *
 * FOUR UNIQUE INDEXES ON `lower(name)`, NOT UNIQUE CONSTRAINTS. Postgres
 * compares text case-sensitively, so a plain UNIQUE accepts «Малина» and
 * «малина» as two products. The DBML contains the evidence that this is what
 * happens to hand-typed catalog data — it is the argument that deleted the
 * `villages` table, where one village appeared four ways in the client's own
 * book: «копайгород» 571 rows, «Копайгород» 175, «Копайгород » with a trailing
 * space 45, «Копай». Names are still STORED exactly as typed; only comparison
 * folds case, so nothing anyone wrote is rewritten.
 *
 * `collection_points` is brought onto the same rule here rather than left
 * behind: two different answers to "are names case-insensitive" in one codebase
 * means the next module copies whichever it reads first.
 *
 * These indexes are invisible to TypeORM metadata. `migration:generate` will
 * propose DROPPING all four; that output must not be applied.
 */
export class YagodaCatalog1788600000005 implements MigrationInterface {
  name = 'YagodaCatalog1788600000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fail loudly rather than destroying data: if two points already differ
    // only by case, the unique index below cannot be created, and the operator
    // must decide which name survives. Naming the values is the difference
    // between a fixable message and a bare constraint-violation stack.
    const collisions: { name: string; occurrences: string; ids: string }[] =
      await queryRunner.query(`
      SELECT lower("name") AS name, count(*)::text AS occurrences,
             string_agg("id"::text, ', ') AS ids
        FROM "collection_points"
       GROUP BY lower("name")
      HAVING count(*) > 1
    `);
    if (collisions.length > 0) {
      // "Rename" is the ONLY remedy that exists — deactivating a colliding row
      // is not an option: `UQ_collection_points_name_lower` is not a partial
      // index (no `WHERE is_active`), so a deactivated collision still
      // collides and the migration would abort again on the very next run.
      // Spec §5.6 forbids DELETE outright. Naming both the values AND the row
      // ids is the difference between a fixable message and a bare
      // constraint-violation stack: the operator can `UPDATE … WHERE id = …`
      // straight from this error without first writing their own `GROUP BY`.
      const detail = collisions
        .map((c) => `"${c.name}" (${c.occurrences}: ${c.ids})`)
        .join(', ');
      throw new Error(
        `Cannot make collection_points.name case-insensitive: these names already ` +
          `collide when case is ignored — ${detail}. Rename the duplicates, ` +
          `then re-run this migration.`,
      );
    }

    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_products" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_products_name_lower" ON "products" (lower("name"))`,
    );

    await queryRunner.query(`
      CREATE TABLE "product_grades" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "product_id" uuid NOT NULL,
        "name" character varying NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_grades" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_grades_product" FOREIGN KEY ("product_id")
          REFERENCES "products"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_product_grades_product_name_lower"
         ON "product_grades" ("product_id", lower("name"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_product_grades_product" ON "product_grades" ("product_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "tare_types" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "weight_kg" numeric(10,2) NOT NULL,
        "deposit_price" numeric(12,2) NOT NULL,
        "is_crate" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tare_types" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_tare_types_weight_kg" CHECK ("weight_kg" >= 0),
        CONSTRAINT "CHK_tare_types_deposit_price" CHECK ("deposit_price" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tare_types_name_lower" ON "tare_types" (lower("name"))`,
    );

    await queryRunner.query(
      `ALTER TABLE "collection_points" DROP CONSTRAINT "UQ_collection_points_name"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_collection_points_name_lower"
         ON "collection_points" (lower("name"))`,
    );
  }

  /**
   * Reverses the schema, not the intent. `down()` always succeeds: the
   * case-insensitive index this migration installed is strictly STRONGER than
   * the plain `UNIQUE("name")` it restores — any row set that satisfies
   * `lower(name)` uniqueness necessarily satisfies plain uniqueness too, since
   * two rows that differ can't collide once case is ignored if they didn't
   * already collide with it. There is no row set `down()` can be run against
   * that would make the `ADD CONSTRAINT` below fail.
   *
   * The risk runs the OTHER direction: re-running `up()` afterwards. Once the
   * weak, case-sensitive constraint is back in place, case-variant names
   * («Копайгород» next to «копайгород») become insertable again, and the
   * collision guard at the top of `up()` will abort until every such pair is
   * renamed. That is the same posture `BootstrapOwner.down()` takes — safe to
   * unwind, not necessarily safe to redo blind.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_collection_points_name_lower"`);
    await queryRunner.query(
      `ALTER TABLE "collection_points" ADD CONSTRAINT "UQ_collection_points_name" UNIQUE ("name")`,
    );

    // product_grades before products: the foreign key points that way.
    await queryRunner.query(`DROP TABLE "product_grades"`);
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(`DROP TABLE "tare_types"`);
  }
}
