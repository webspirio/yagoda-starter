/**
 * EVERY FIXTURE HERE IS A THROWAWAY GIT REPOSITORY. Nothing under this suite writes inside
 * the real working tree: the check takes `--root <dir>`, so a fixture is a `mkdtempSync`
 * repo with its own `28-db-schema.dbml`, its own entities and its own controllers.
 *
 * THE HARD PART OF TESTING THIS CHECK IS THE GREEN CASE. "No banned verb found" and "never
 * opened the file" print the same thing, and the real tree is green today, so a suite that
 * only asserted green would pass just as happily against a check that scanned nothing. Two
 * things close that:
 *
 *   - the fixture's NON-document controller carries a `@Patch`, and the fixture is green.
 *     That is not an absence of evidence; it is evidence the scope derivation excluded a
 *     directory it could see, and the next test moves the same decorator into a document
 *     directory and asserts the exact line.
 *   - `scan()` takes the banned set as a parameter, so one test swaps it for a verb the
 *     fixture is full of and asserts the walk reports every one, at its line. A decorator
 *     walker that silently matches nothing cannot pass that.
 *
 * Exactly ONE test runs against the real repository, and its discriminator is an
 * INDEPENDENT derivation of the voidable tables, by a line loop that shares no code with
 * the check's DBML parser.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { scan } from './document-immutability.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'checks', 'document-immutability.mjs')

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
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/**
 * `doc` and `ledger` are voidable; `catalog` is not. The `''' … '''` note quotes
 * `voided_at IS NULL` out of SQL exactly the way the real file does twenty times over — if
 * the derivation anchored on the WORD rather than the column declaration, `catalog` would
 * be in scope and the `@Patch` below would turn this fixture red.
 */
const DBML = `
Table doc {
  id uuid [pk]

  voided_at timestamp

  created_at timestamp [not null]
}

Table ledger {
  id uuid [pk]

  voided_at timestamp

  created_at timestamp [not null]
}

Table catalog {
  id uuid [pk]

  name varchar(64) [not null]

  Note: '''
  сума рахується так: WHERE catalog.voided_at IS NULL — і це ПРОЗА, не колонка
  '''
}
`

/** @param {string} table @returns {string} */
const entity = (table) => `import { Entity } from 'typeorm';

@Entity('${table}')
export class ${table} {}
`

const DOC_CONTROLLER = `import { Controller, Get, Post } from '@nestjs/common';

@Controller('doc')
export class DocController {
  @Get()
  list() {}

  @Post()
  create() {}

  @Post(':id/void')
  void_() {}
}
`

const LEDGER_CONTROLLER = `import { Controller, Post } from '@nestjs/common';

@Controller('ledger')
export class LedgerController {
  @Post()
  create() {}
}
`

/** A `@Patch` OUTSIDE the derived scope. The fixture is green WITH this in it. */
const CATALOG_CONTROLLER = `import { Controller, Patch } from '@nestjs/common';

@Controller('catalog')
export class CatalogController {
  @Patch(':id')
  rename() {}
}
`

/** @param {string} root @param {string} rel @param {string} content */
function write(root, rel, content) {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

/** @returns {{ root: string, cleanup: () => void }} */
function fixtureRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-documents-'))
  execFileSync('git', ['init', '-q'], { cwd: root, env: NO_GIT_ENV, stdio: 'pipe' })
  write(root, '28-db-schema.dbml', DBML)
  for (const table of ['doc', 'ledger', 'catalog']) {
    write(root, `backend/src/${table}/${table}.entity.ts`, entity(table))
  }
  write(root, 'backend/src/doc/doc.controller.ts', DOC_CONTROLLER)
  write(root, 'backend/src/ledger/ledger.controller.ts', LEDGER_CONTROLLER)
  write(root, 'backend/src/catalog/catalog.controller.ts', CATALOG_CONTROLLER)
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
 * @param {string} content
 * @param {string} needle
 * @returns {number} the 1-based line the needle sits on
 */
function lineOf(content, needle) {
  const index = content.indexOf(needle)
  assert.notEqual(index, -1, `fixture no longer contains ${needle}`)
  return content.slice(0, index).split('\n').length
}

test('the real tree is green, and the scope it prints matches an independent derivation', () => {
  // THE ONE permitted whole-repository assertion in this file. The discriminator is a
  // SECOND derivation of the voidable tables — a plain line loop over the DBML, sharing no
  // code with parseDbml — so the two can disagree, and a check that read nothing cannot
  // name six tables.
  const dbml = readFileSync(path.join(ROOT, '28-db-schema.dbml'), 'utf8')
  /** @type {string[]} */
  const voidable = []
  /** @type {string|null} */
  let table = null
  for (const line of dbml.split('\n')) {
    const open = /^Table\s+(\w+)\s*\{/.exec(line)
    if (open) {
      table = open[1]
      continue
    }
    if (line.startsWith('}')) {
      table = null
      continue
    }
    if (table && /^\s+voided_at\s+\S/.test(line)) voidable.push(table)
  }
  assert.ok(voidable.length > 0, 'the DBML declares no voided_at column at all — this test lost its subject')

  const res = run()
  assert.equal(res.status, 0, res.out)
  assert.match(res.out, new RegExp(`declares: ${voidable.sort().join(', ')}\\n$`))
  const controllers = /on the (\d+) controller\(s\)/.exec(res.out)
  assert.ok(controllers && Number(controllers[1]) > 0, `no controller count in:\n${res.out}`)
})

test('a clean fixture is green WHILE a @Patch sits outside the derived scope', () => {
  // The scoping discriminator. `catalog` has no voided_at column, so its @Patch is not this
  // check's business — and the very next test moves that decorator into `doc/` and gets a
  // red at an exact line, which is what makes this green mean something.
  withFixture((root) => {
    const res = run(root)
    assert.equal(res.status, 0, res.out)
    assert.match(res.out, /on the 2 controller\(s\) derived from the 2 voidable table\(s\)/)
    assert.match(res.out, /declares: doc, ledger/)
  })
})

test('@Patch on a document controller is red, at its line', () => {
  withFixture((root) => {
    const broken = DOC_CONTROLLER.replace('  @Get()\n  list() {}', '  @Patch(\':id\')\n  edit() {}')
    write(root, 'backend/src/doc/doc.controller.ts', broken)
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, new RegExp(`doc\\.controller\\.ts:${lineOf(broken, '@Patch')}: @Patch on a document controller \\(doc\\)`))
  })
})

test('@Put on a document controller is red, at its line', () => {
  withFixture((root) => {
    const broken = LEDGER_CONTROLLER.replace('  @Post()\n  create() {}', '  @Put(\':id\')\n  replace() {}')
    write(root, 'backend/src/ledger/ledger.controller.ts', broken)
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, new RegExp(`ledger\\.controller\\.ts:${lineOf(broken, '@Put')}: @Put on a document controller \\(ledger\\)`))
  })
})

test('@Delete on a document controller is red, at its line', () => {
  withFixture((root) => {
    const broken = DOC_CONTROLLER.replace('  @Get()\n  list() {}', '  @Delete(\':id\')\n  destroy() {}')
    write(root, 'backend/src/doc/doc.controller.ts', broken)
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, new RegExp(`doc\\.controller\\.ts:${lineOf(broken, '@Delete')}: @Delete on a document controller`))
  })
})

test('SWAPPING THE BANNED SET makes the same green fixture red at every verb it has', () => {
  // The positive discriminator for the decorator walk itself. `@Post` is what the fixture's
  // document controllers are made of, so banning it must produce a finding at every one of
  // them — a walker that matched nothing would still report zero.
  withFixture((root) => {
    const result = scan(root, new Set(['Post']))
    const lines = result.findings.map((f) => f.split(':').slice(0, 2).join(':')).sort()
    assert.deepEqual(lines, [
      `backend/src/doc/doc.controller.ts:${lineOf(DOC_CONTROLLER, '@Post()')}`,
      `backend/src/doc/doc.controller.ts:${lineOf(DOC_CONTROLLER, "@Post(':id/void')")}`,
      `backend/src/ledger/ledger.controller.ts:${lineOf(LEDGER_CONTROLLER, '@Post()')}`,
    ].sort())
    // And the scope it walked is the derived one, not everything in sight: `catalog`'s
    // controller has no @Post, but neither is it in `scope` at all.
    assert.deepEqual([...result.scope.keys()].map((f) => path.basename(f)).sort(), [
      'doc.controller.ts',
      'ledger.controller.ts',
    ])
  })
})

test('a voidable table with no @Entity is red, naming the table', () => {
  withFixture((root) => {
    write(root, 'backend/src/ledger/ledger.entity.ts', entity('renamed'))
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /voided_at column on table 'ledger' and no @Entity\('ledger'\)/)
  })
})

test('a DBML where nothing declares voided_at REFUSES a verdict rather than reporting one', () => {
  // Hop 1 made to match nothing — a renamed column, a reworded schema. The old prototype of
  // this check printed "immutable" over an empty scope and exited 0.
  withFixture((root) => {
    write(root, '28-db-schema.dbml', DBML.replaceAll('voided_at timestamp', 'cancelled_at timestamp'))
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /scanned ZERO tables declaring a voided_at column/)
  })
})

test('a derivation that reaches no controller REFUSES a verdict rather than reporting one', () => {
  // Hop 3 made to match nothing — the controllers moved out of the entity's directory.
  withFixture((root) => {
    rmSync(path.join(root, 'backend/src/doc/doc.controller.ts'))
    rmSync(path.join(root, 'backend/src/ledger/ledger.controller.ts'))
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /scanned ZERO document controllers derived from those tables/)
  })
})

test('a missing schema of record is an error, not a green', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-documents-nodbml-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: root, env: NO_GIT_ENV, stdio: 'pipe' })
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /could not read 28-db-schema\.dbml/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
