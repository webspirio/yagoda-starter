import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * §8.3 «Витрати дня» — spec §3.8.
 *
 * THIS TABLE IS MUTABLE, AND THAT IS THE ONLY EXCEPTION IN THE SCHEMA. There is
 * no `void_*` trio here, deliberately. §2.7's freeze protects «те, що
 * надруковано на папері» — a document in a supplier's hand that must not drift
 * from the database. Nothing is printed for «пальне 1 000,00», nobody is owed
 * it, and §8.3's «+ ще рядок» is explicitly a scratchpad gesture whose total
 * «перераховується сам після кожного рядка». Forcing a void-with-reason to fix
 * a typo in «вантажник» would be ceremony with no reader.
 *
 * THE COST IS NAMED: a past day's собівартість can change with no journal
 * trace. The audit log is what answers «чому вчорашні 6,39 стали 6,51» —
 * `day-expense.updated` carries before/after. Whoever decides that is not
 * enough should add the void trio, not an audit table: there is already one.
 *
 * `shift_id`, NOT `collection_point_id` + `business_date`. §8.3 — «Витрата
 * належить ОДНОМУ пункту; витрат рівня "вся мережа" не існує», and the shift is
 * how every other document in this schema learns its point and its date. A
 * trip serving three points is split by the owner himself: «ви ділите пальне в
 * себе і записуєте, куди треба».
 *
 * NO CLOSED LIST OF CATEGORIES. §8.3 — «закритого списку статей немає, підпис
 * рядка пише керівник». `label` is free text on purpose; an enum here would be
 * the restriction the client explicitly does not have.
 */
export class YagodaDayExpenses1788600000014 implements MigrationInterface {
  name = 'YagodaDayExpenses1788600000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "day_expenses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "shift_id" uuid NOT NULL,
        "label" character varying NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "created_by_user_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_day_expenses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_day_expenses_shift" FOREIGN KEY ("shift_id")
          REFERENCES "shifts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_day_expenses_created_by" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        -- A zero expense is a row with no reader; a negative one is income, and
        -- §8.3 has no such thing.
        CONSTRAINT "CHK_day_expenses_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_day_expenses_label" CHECK (btrim("label") <> '')
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_day_expenses_shift" ON "day_expenses" ("shift_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "day_expenses"`);
  }
}
