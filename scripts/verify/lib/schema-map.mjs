/**
 * The derivations `schema` and `documents` both stand on: the schema of record parsed,
 * the entities read, and the `backend/src` file set enumerated the way every other check
 * in this layer enumerates it.
 *
 * IT LIVES HERE BECAUSE BOTH CHECKS DERIVE THEIR SCOPE FROM THE SAME TWO ARTEFACTS, and
 * a second copy of a scope derivation is a second thing to keep in step. `schema`
 * compares `28-db-schema.dbml`'s numeric columns against the `@Column` that maps them and
 * the `CREATE TABLE` that creates them; `documents` reads the same file for the
 * `voided_at` columns that mark a voidable document and the same entities for the
 * directory each of those tables lives in. Neither names a table, a module or a file.
 *
 * DENY BY EXHAUSTION, NOT BY OMISSION. `parseDbml` returns a `findings` array, and a
 * depth-1 line inside a `Table` block that it cannot model goes in it. A parser that
 * silently skips what it does not recognise reports "no mismatch" for a column it never
 * read, which is the false green this whole layer exists to refuse — so the rule is that
 * every column line is either understood or named.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { errMessage } from '../hash.mjs'
import { gitEnv } from '../scan-root.mjs'

/** The schema of record (root CLAUDE.md, "Domain"), repo-root-relative. */
export const DBML_REL = '28-db-schema.dbml'

/** DBML and TypeORM both spell the same Postgres type two ways. */
const NUMERIC_TYPE = /^(?:numeric|decimal)$/i

/**
 * A DBML column line at table depth 1: `name type(precision, scale) [settings]`, with the
 * parenthesised size and the bracketed settings both optional. Anchored at both ends, so
 * anything it does not match is reported rather than skipped.
 */
const COLUMN_LINE = /^(\w+)\s+(\w+)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?\s*(\[[^\]]*\])?$/

/** The column whose presence makes a table a voidable document (§9.3). */
const VOID_COLUMN = 'voided_at'

/**
 * @typedef {object} DbmlColumn
 * @property {number} precision
 * @property {number} scale
 * @property {boolean} notNull
 * @property {string|null} default the `default:` setting's text, trimmed
 * @property {string} at `28-db-schema.dbml:<line>`
 */

/**
 * @typedef {object} DbmlSchema
 * @property {string[]} tables every `Table` block, in file order
 * @property {Map<string, DbmlColumn>} numeric keyed `table.column`
 * @property {string[]} voidable tables declaring a `voided_at` COLUMN, sorted
 * @property {string[]} findings lines inside a `Table` block this parser refused to model
 */

/**
 * Parse `28-db-schema.dbml`.
 *
 * The syntax actually present in this file, all of which is handled here and none of
 * which may be mistaken for a column: single-line `Note: '…'`; multi-paragraph
 * `Note: ''' … '''` blocks full of Cyrillic prose, braces, `[not null]` text and literal
 * `numeric(12,2)` and `voided_at IS NULL` fragments quoted out of SQL; `/* … *\/` banner
 * comments; `//` line comments; an `indexes { … }` sub-block; and `[pk]`,
 * `[unique, not null]`, `[not null, default: 'reception']`, `[not null, ref: > t.id]`
 * settings. `Enum` blocks never match, because the table opener requires the `Table`
 * keyword.
 *
 * The `voided_at` derivation is anchored on a COLUMN DECLARATION for exactly that reason:
 * the file mentions `voided_at` far more often in Note prose quoting SQL than it declares
 * it, and a grep would put every table that is merely DISCUSSED into the scope.
 *
 * @param {string} root
 * @returns {DbmlSchema}
 */
export function parseDbml(root) {
  /** @type {string[]} */
  const tables = []
  /** @type {Map<string, DbmlColumn>} */
  const numeric = new Map()
  /** @type {Set<string>} */
  const voidable = new Set()
  /** @type {string[]} */
  const findings = []

  /** @type {string} */
  let text
  try {
    text = readFileSync(path.join(root, DBML_REL), 'utf8')
  } catch (err) {
    throw new Error(`could not read ${DBML_REL}: ${errMessage(err)}`)
  }

  const lines = text.split('\n')
  /** @type {string|null} */
  let table = null
  let depth = 0
  let inNote = false
  let inComment = false

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (inNote) {
      if (line.includes("'''")) inNote = false
      continue
    }
    if ((line.match(/'''/g) ?? []).length % 2 === 1) {
      inNote = true
      continue
    }
    if (inComment) {
      if (line.includes('*/')) inComment = false
      continue
    }
    if (line.includes('/*') && !line.includes('*/')) {
      inComment = true
      continue
    }
    line = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '').trim()
    if (!line) continue

    if (table === null) {
      const open = /^Table\s+"?(\w+)"?\s*\{/.exec(line)
      if (open) {
        table = open[1]
        tables.push(open[1])
        depth = 1
      }
      continue
    }

    // A single-line `Note: '…'` is prose, and this file's prose is full of braces. Counting
    // them would push the parser to depth 2 and silently hide every column line below it —
    // so the note is skipped BEFORE the brace arithmetic, not after.
    if (depth === 1 && /^Note\s*:/.test(line)) continue

    const outer = depth
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
    if (depth <= 0) {
      table = null
      continue
    }
    if (outer !== 1 || line.startsWith('}') || /^indexes\s*\{/.test(line)) continue

    const at = `${DBML_REL}:${i + 1}`
    const matched = COLUMN_LINE.exec(line)
    if (!matched) {
      findings.push(
        `${at}: unparsed line in Table ${table} — \`${line}\`. This parser must understand ` +
          'every column line or it is guessing: a line it skips is a column nothing compares.',
      )
      continue
    }
    const [, column, type, precision, scale, settings] = matched
    if (column === VOID_COLUMN) voidable.add(table)
    if (!NUMERIC_TYPE.test(type)) continue
    if (!scale) {
      findings.push(
        `${at}: ${table}.${column} is \`${type}\` without an explicit (precision, scale) — ` +
          'an unqualified numeric has no scale at all in Postgres, so nothing here can be compared.',
      )
      continue
    }
    const opts = settings ?? ''
    numeric.set(`${table}.${column}`, {
      precision: Number(precision),
      scale: Number(scale),
      notNull: /\bnot null\b/i.test(opts),
      default: /default:\s*([^,\]]+)/.exec(opts)?.[1]?.trim() ?? null,
      at,
    })
  }

  return { tables, numeric, voidable: [...voidable].sort(), findings }
}

/**
 * Every file under `backend/src`, tracked or untracked-but-not-ignored — the same
 * `-c -o --exclude-standard` combination `seam` and `migrations` use, and for the same
 * reason: a fixture file that has never been `git add`ed must still be seen, or a red-case
 * test that merely writes a file would report a false green.
 *
 * `env: gitEnv()` is not optional. `cwd` does not win over `GIT_DIR`, and git exports that
 * variable into every hook it runs — without the scrub this enumerates whatever repository
 * the ambient environment names instead of `root`.
 *
 * @param {string} root
 * @returns {string[]} absolute paths, sorted
 */
export function backendSrcFiles(root) {
  const NUL = String.fromCharCode(0)
  /** @type {Buffer} */
  let raw
  try {
    raw = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z', '--', 'backend/src'], {
      cwd: root,
      env: gitEnv(),
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (err) {
    throw new Error(`git could not enumerate backend/src under ${root}: ${errMessage(err)}`)
  }
  return raw
    .toString('utf8')
    .split(NUL)
    .filter(Boolean)
    .map((rel) => path.join(root, rel))
    .sort()
}

/**
 * Syntax only — `ts.createSourceFile`, never `ts.createProgram`. Nothing here needs a type
 * checker, and a tree that does not type-check still parses, so neither check has to be
 * ordered behind `typecheck`.
 *
 * @param {string} absPath
 * @returns {ts.SourceFile}
 */
export function parseTsFile(absPath) {
  return ts.createSourceFile(
    absPath,
    readFileSync(absPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
}

/**
 * The `@Name(...)` decorator call on a node, if it has one. Module-local: `readEntities`
 * below is the one caller, and an export nothing imports is what `deadcode` exists to name.
 *
 * @param {ts.Node} node
 * @param {string} name
 * @returns {ts.CallExpression|undefined}
 */
function decoratorCall(node, name) {
  const decorators = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []
  for (const decorator of decorators) {
    const expr = decorator.expression
    if (!ts.isCallExpression(expr)) continue
    const call = /** @type {ts.CallExpression} */ (expr)
    if (ts.isIdentifier(call.expression) && call.expression.text === name) return call
  }
  return undefined
}

/**
 * The identifier names of a node's decorators, call form or not (`@Patch(':id')` and a
 * bare `@Injectable` both yield their name).
 *
 * @param {ts.Node} node
 * @returns {string[]}
 */
export function decoratorNames(node) {
  const decorators = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []
  return decorators.flatMap((decorator) => {
    const expr = decorator.expression
    const head = ts.isCallExpression(expr)
      ? /** @type {ts.CallExpression} */ (expr).expression
      : expr
    return ts.isIdentifier(head) ? [/** @type {ts.Identifier} */ (head).text] : []
  })
}

/**
 * @typedef {object} EntityColumn
 * @property {string} table the `@Entity('<table>')` argument
 * @property {string} property the TypeScript property name, which IS the column name —
 *   see `nameOption`
 * @property {string|null} type the `type:` option, verbatim
 * @property {number|null} precision
 * @property {number|null} scale
 * @property {boolean} nullable
 * @property {string|null} default the `default:` option, stringified
 * @property {string|null} nameOption a `name:` option, which BREAKS property-is-column and
 *   is therefore reported by `schema` rather than followed
 * @property {string} tsType the declared property type, whitespace-collapsed
 * @property {string} at `<repo-relative file>:<line>`
 */

/**
 * @typedef {object} Entities
 * @property {Map<string, string>} dirs `@Entity('<table>')` -> the absolute directory of
 *   the file declaring it
 * @property {EntityColumn[]} columns every `@Column`-decorated property, in file order
 */

/**
 * Read every `*.entity.ts` under `backend/src` in ONE pass, because both consumers want a
 * different half of the same walk: `documents` needs the table-to-directory map, `schema`
 * needs the columns, and parsing the files twice to hand them out separately would be pure
 * waste.
 *
 * @param {string} root
 * @returns {Entities}
 */
export function readEntities(root) {
  /** @type {Map<string, string>} */
  const dirs = new Map()
  /** @type {EntityColumn[]} */
  const columns = []

  for (const file of backendSrcFiles(root).filter((f) => f.endsWith('.entity.ts'))) {
    const sourceFile = parseTsFile(file)
    const rel = path.relative(root, file)
    /** @param {ts.Node} node @returns {string} */
    const at = (node) =>
      `${rel}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`

    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement)) continue
      const entity = decoratorCall(statement, 'Entity')
      const tableArg = entity?.arguments[0]
      if (!tableArg || !ts.isStringLiteralLike(tableArg)) continue
      const table = tableArg.text
      dirs.set(table, path.dirname(file))

      for (const member of statement.members) {
        if (!ts.isPropertyDeclaration(member)) continue
        const column = decoratorCall(member, 'Column')
        if (!column) continue

        /** @type {Map<string, string>} */
        const opts = new Map()
        const literal = column.arguments.find(ts.isObjectLiteralExpression)
        for (const prop of literal?.properties ?? []) {
          if (!ts.isPropertyAssignment(prop)) continue
          const value = prop.initializer
          opts.set(
            prop.name.getText(sourceFile),
            ts.isStringLiteralLike(value) ? value.text : value.getText(sourceFile),
          )
        }

        const precision = opts.get('precision')
        const scale = opts.get('scale')
        columns.push({
          table,
          property: member.name.getText(sourceFile),
          type: opts.get('type') ?? null,
          precision: precision === undefined ? null : Number(precision),
          scale: scale === undefined ? null : Number(scale),
          nullable: opts.get('nullable') === 'true',
          default: opts.get('default') ?? null,
          nameOption: opts.get('name') ?? null,
          tsType: member.type ? member.type.getText(sourceFile).replace(/\s+/g, ' ') : '(inferred)',
          at: at(member),
        })
      }
    }
  }

  return { dirs, columns }
}
