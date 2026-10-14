import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * #145 (client correction, 2026-10-14) — the receipt header prints «Точка № 3 · Приймальник № 5»
 * instead of the point's name and the operator's full name, so both tables gain a short `number`.
 *
 * Nobody types it: existing rows are numbered 1, 2, 3… in creation order (`created_at`, then
 * `id`), and the column then becomes an identity whose sequence continues after the highest
 * number, so a new point or user takes the next one. Neither table has a DELETE path (§5.6 —
 * deactivation only), so a number, once printed, keeps naming the same row.
 *
 * `ALWAYS`, not `BY DEFAULT`: «nobody types it» is enforced by the schema, not by habit. A
 * `BY DEFAULT` identity accepts a supplied value without moving its sequence, so the row that
 * fails is the NEXT ordinary insert (a `UQ_…_number` 500 on someone else's `POST`). TypeORM
 * inserts an `undefined` generated column as the literal `DEFAULT`, which `ALWAYS` accepts.
 *
 * Why a new number and not `code`: the client asked for «Точка № 3» (14.10.2026), and `code`
 * (`SHP`) already prints on the same paper inside «№ квитанції». The numbering runs over every
 * point, the warehouse and registry-only ones included, so the working points are not 1–5.
 *
 * Every statement interpolates `${table}`, which makes it a template expression that
 * `scripts/verify/checks/schema-conformance.mjs` does not collect — the same blind spot as a
 * hoisted constant (see 023). Harmless here (`integer`, and the check reads `numeric` only);
 * a migration adding a `numeric` column must spell each table out.
 */
export class PointAndUserNumbers1788600000024 implements MigrationInterface {
  name = 'PointAndUserNumbers1788600000024';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of ['collection_points', 'users']) {
      await q.query(`ALTER TABLE "${table}" ADD "number" integer`);
      await q.query(
        `UPDATE "${table}" t SET "number" = r.n
           FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n FROM "${table}") r
          WHERE r."id" = t."id"`,
      );
      await q.query(`ALTER TABLE "${table}" ALTER COLUMN "number" SET NOT NULL`);
      await q.query(
        `ALTER TABLE "${table}" ALTER COLUMN "number" ADD GENERATED ALWAYS AS IDENTITY`,
      );
      await q.query(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'number'),
                       COALESCE((SELECT MAX("number") FROM "${table}"), 0) + 1, false)`,
      );
      await q.query(`ALTER TABLE "${table}" ADD CONSTRAINT "UQ_${table}_number" UNIQUE ("number")`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" DROP COLUMN "number"`);
    await q.query(`ALTER TABLE "collection_points" DROP COLUMN "number"`);
  }
}
