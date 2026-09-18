/**
 * EVERY FIXTURE HERE IS A THROWAWAY GIT REPOSITORY. Nothing under this suite writes inside
 * the real working tree: the check takes `--root <dir>`, so a fixture is a `mkdtempSync`
 * repo with its own `28-db-schema.dbml`, its own entity and its own migration.
 *
 * TWO RULES SHAPE WHAT IS ASSERTED HERE.
 *
 * "Green" is never asserted on its own. A check that never looked at a file reports the
 * same green as one that looked and found nothing, so every fixture asserted green either
 * carries a discriminator (a printed count derived from the fixture) or is the SAME
 * fixture another test mutates one field of and asserts red at an exact line.
 *
 * And exactly ONE test runs against the real repository, per this layer's own invariant.
 * Its discriminator is an INDEPENDENT count of the DBML's numeric column lines, computed
 * here with a regex that shares no code with the check's parser — so the two can disagree.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { scan } from './schema-conformance.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'checks', 'schema-conformance.mjs')

/** `cwd` does not win over `GIT_DIR`; without the scrub a fixture's git reads another repo. */
const NO_GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
}

/**
 * @param {string} [root] when omitted, the check runs against the real repository
 * @returns {{ status: number, out: string }}
 */
function run(root) {
  const args = root ? [CHECK, '--root', root] : [CHECK]
  try {
    return { status: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8' }) }
  } catch (err) {
    // Cast needed under `tsc -p tsconfig.scripts.json` (checkJs + strict types a catch
    // binding as `unknown`) — same idiom as migration-invariants.test.mjs's run().
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

const DBML = `
/* ------ фікстура ------ */
// коментар рядком

Table demo {
  id uuid [pk]

  amount numeric(12,2) [not null]
  rate   numeric(10,2)
  bonus  numeric(10,2) [not null, default: 0]

  created_at timestamp [not null]

  indexes {
    (amount)
  }

  Note: 'однорядкова нотатка з дужками { } і з numeric(9,9) у тексті'
}

Table plain {
  id uuid [pk]

  Note: '''
  багаторядкова нотатка, що цитує numeric(7,7) і voided_at IS NULL,
  з дужками { } та [not null] усередині
  '''
}
`

const ENTITY = `import { Column, Entity } from 'typeorm';

@Entity('demo')
export class Demo {
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  rate: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  bonus: string;
}
`

const PLAIN_ENTITY = `import { Entity } from 'typeorm';

@Entity('plain')
export class Plain {}
`

const MIGRATION = `export class Demo1700000000000 {
  public async up(queryRunner) {
    await queryRunner.query(\`
      CREATE TABLE "demo" (
        "id" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "rate" numeric(10,2),
        "bonus" numeric(10,2) NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL
      )
    \`);
  }
}
`

/** @param {string} root @param {string} rel @param {string} content */
function write(root, rel, content) {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

/**
 * A throwaway repository shaped like this one: a DBML, one entity, one migration.
 *
 * @returns {{ root: string, cleanup: () => void }}
 */
function fixtureRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-schema-'))
  execFileSync('git', ['init', '-q'], { cwd: root, env: NO_GIT_ENV, stdio: 'pipe' })
  write(root, '28-db-schema.dbml', DBML)
  write(root, 'backend/src/demo/demo.entity.ts', ENTITY)
  write(root, 'backend/src/plain/plain.entity.ts', PLAIN_ENTITY)
  write(root, 'backend/src/migrations/1700000000000-Demo.ts', MIGRATION)
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** @param {(root: string) => void} fn */
function withFixture(fn) {
  const { root, cleanup } = fixtureRepo()
  try {
    fn(root)
  } finally {
    cleanup()
  }
}

/**
 * The 1-based line a needle sits on, so a red-case assertion pins a real location instead
 * of a number somebody counted by hand and will not re-count after the next edit.
 *
 * @param {string} content
 * @param {string} needle
 * @returns {number}
 */
function lineOf(content, needle) {
  const index = content.indexOf(needle)
  assert.notEqual(index, -1, `fixture no longer contains ${needle}`)
  return content.slice(0, index).split('\n').length
}

test('the real tree is green, and the count it prints matches an independent one', () => {
  // THE ONE permitted whole-repository assertion in this file. Its discriminator is a
  // SECOND derivation of the numeric column count, by a regex over the DBML that shares no
  // code with the check's parser: a scanner that quietly read nothing cannot agree with it.
  const dbml = readFileSync(path.join(ROOT, '28-db-schema.dbml'), 'utf8')
  const declared = dbml.split('\n').filter((l) => /^\s+\w+\s+numeric\(\d+,\s*\d+\)/.test(l)).length
  assert.ok(declared > 0, 'the DBML declares no numeric column at all — this test lost its subject')

  const res = run()
  assert.equal(res.status, 0, res.out)
  const printed = /schema: conformant — (\d+) numeric columns across (\d+) /.exec(res.out)
  assert.ok(printed, `no summary line to read a count from:\n${res.out}`)
  assert.equal(Number(printed[1]), declared)
  assert.ok(Number(printed[2]) > 0, 'the check reported zero tables and still called itself green')
})

test('a clean fixture is green, and says how much it compared', () => {
  withFixture((root) => {
    const res = run(root)
    assert.equal(res.status, 0, res.out)
    // Three numeric columns over two tables — the discriminator. A check that skipped the
    // fixture cannot print the fixture's own shape, and every red test below mutates this
    // same fixture by exactly one field.
    assert.match(res.out, /schema: conformant — 3 numeric columns across 2 /)
  })
})

test('a numeric(p,s) quoted inside a Note is PROSE, not a column', () => {
  // The fixture's two notes quote `numeric(9,9)` and `numeric(7,7)` the way the real file
  // quotes SQL in twenty of its own notes. Calling scan() directly is what makes this an
  // assertion about the parse rather than about the exit code: three columns, and the two
  // quoted ones are not among them.
  withFixture((root) => {
    const result = scan(root)
    assert.deepEqual(result.findings, [])
    assert.equal(result.dbmlNumeric, 3)
    assert.equal(result.dbmlTables, 2)
  })
})

test('a `numeric` property typed `number` is red, at the property line', () => {
  withFixture((root) => {
    const broken = ENTITY.replace('amount: string;', 'amount: number;')
    write(root, 'backend/src/demo/demo.entity.ts', broken)
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(
      res.out,
      new RegExp(`demo\\.entity\\.ts:${lineOf(broken, "@Column({ type: 'numeric', precision: 12")}: demo\\.amount`),
    )
    assert.match(res.out, /TypeScript property type is `number`/)
  })
})

test("an entity's precision that disagrees with the DBML is red", () => {
  withFixture((root) => {
    write(root, 'backend/src/demo/demo.entity.ts', ENTITY.replace('precision: 12, scale: 2', 'precision: 14, scale: 2'))
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /demo\.amount entity numeric\(14,2\) != 28-db-schema\.dbml numeric\(12,2\)/)
  })
})

test('a migration column whose nullability disagrees with the DBML is red, at the SQL line', () => {
  withFixture((root) => {
    const broken = MIGRATION.replace('"amount" numeric(12,2) NOT NULL,', '"amount" numeric(12,2),')
    write(root, 'backend/src/migrations/1700000000000-Demo.ts', broken)
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(
      res.out,
      new RegExp(`1700000000000-Demo\\.ts:${lineOf(broken, '"amount" numeric')}: demo\\.amount SQL nullable`),
    )
  })
})

test('a migration DEFAULT that disagrees with the DBML is red', () => {
  withFixture((root) => {
    write(
      root,
      'backend/src/migrations/1700000000000-Demo.ts',
      MIGRATION.replace('NOT NULL DEFAULT 0,', 'NOT NULL DEFAULT 1,'),
    )
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /demo\.bonus SQL DEFAULT 1 != 28-db-schema\.dbml default 0/)
  })
})

test('THE REVERSE DIRECTION: a numeric column the DBML does not declare is red', () => {
  // The direction that was actually red on the real tree when this check was written, on
  // grade_prices.max_markup and max_discount. A schema of record missing columns is not one.
  withFixture((root) => {
    const extended = ENTITY.replace(
      '  bonus: string;',
      "  bonus: string;\n\n  @Column({ type: 'numeric', precision: 10, scale: 2 })\n  undeclared: string;",
    )
    write(root, 'backend/src/demo/demo.entity.ts', extended)
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /demo\.undeclared is numeric here and 28-db-schema\.dbml/)
  })
})

test('a DBML line the parser cannot model is red, naming the line', () => {
  withFixture((root) => {
    const broken = DBML.replace('  rate   numeric(10,2)\n', '  rate   numeric(10,2) fancy new syntax here\n')
    write(root, '28-db-schema.dbml', broken)
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, new RegExp(`28-db-schema\\.dbml:${lineOf(broken, '  rate   numeric')}: unparsed line`))
  })
})

test('a numeric token in `up()` SQL outside a CREATE TABLE column is red', () => {
  withFixture((root) => {
    write(
      root,
      'backend/src/migrations/1700000000000-Demo.ts',
      MIGRATION.replace(
        '  }\n}\n',
        '    await queryRunner.query(\'ALTER TABLE "demo" ALTER COLUMN "rate" TYPE numeric(12,4)\');\n  }\n}\n',
      ),
    )
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /did not consume as a column/)
  })
})

test('a DBML table with no @Entity is red', () => {
  withFixture((root) => {
    write(root, 'backend/src/plain/plain.entity.ts', PLAIN_ENTITY.replace("'plain'", "'renamed'"))
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /declares table "plain" and no @Entity\('plain'\)/)
  })
})

test('an @Column({ name }) is red — it breaks the property-is-column join', () => {
  withFixture((root) => {
    write(
      root,
      'backend/src/demo/demo.entity.ts',
      ENTITY.replace("@Column({ type: 'numeric', precision: 12, scale: 2 })", "@Column({ name: 'amt', type: 'numeric', precision: 12, scale: 2 })"),
    )
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /@Column\(\{ name: 'amt' \}\)/)
  })
})

test('a configured namingStrategy is red', () => {
  withFixture((root) => {
    write(root, 'backend/src/app.module.ts', 'export const options = { namingStrategy: new Snake() };\n')
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /a namingStrategy is configured/)
  })
})

test('a DBML with no tables REFUSES a verdict rather than reporting one', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-schema-empty-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: root, env: NO_GIT_ENV, stdio: 'pipe' })
    write(root, '28-db-schema.dbml', '// нічого, крім коментаря\n')
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /scanned ZERO tables in 28-db-schema\.dbml/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a tree with no @Entity at all REFUSES a verdict rather than reporting one', () => {
  // The failure mode `--root` makes MORE likely, not less: point a check at the wrong
  // directory and it agrees with you.
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-schema-noentity-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: root, env: NO_GIT_ENV, stdio: 'pipe' })
    write(root, '28-db-schema.dbml', DBML)
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /scanned ZERO backend\/src @Entity classes/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a missing schema of record is an error, not a green', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-schema-nodbml-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: root, env: NO_GIT_ENV, stdio: 'pipe' })
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /could not read 28-db-schema\.dbml/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
