import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `user_credentials.password_enc` — the encrypted copy of a password that
 * `GET /users/:id/password` reads back for the network owner (issue #11:
 * «Я також хочу бачити логін та пароль кожного користувача»).
 *
 * THREE THINGS A READER SHOULD NOT "FIX":
 *
 * 1. NULLABLE, AND IT STAYS NULLABLE. Every credential that exists when this
 *    runs has a hash and nothing else — a hash cannot be turned back into a
 *    password, so there is no backfill to write and never will be. Null is the
 *    normal state for an older account and means "nothing to show, reissue the
 *    password", which is exactly what the registry displays.
 * 2. IT IS NOT A SECOND VERIFIER. Nothing on the login path reads this column;
 *    `CredentialsService.verify()` checks `password_hash` and would keep
 *    working if every value here were deleted. Wiring login to this column
 *    would trade scrypt for a reversible secret and is the one change this
 *    schema must never accept.
 * 3. THE KEY IS NOT IN THE DATABASE. `PASSWORD_VAULT_KEY` lives in the
 *    environment, so a dump of this table without it yields nothing. Unset is
 *    the default and leaves this column null forever, which is a supported
 *    deployment rather than a broken one — see `src/users/secret-box.ts` for
 *    the trade this feature makes.
 *
 * `down()` drops the column, discarding the readable copies. That is not data
 * loss in the usual sense: every password remains verifiable through its hash,
 * and every account keeps logging in.
 */
export class UserPasswordVault1788600000013 implements MigrationInterface {
  name = 'UserPasswordVault1788600000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_credentials" ADD "password_enc" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_credentials" DROP COLUMN "password_enc"`);
  }
}
