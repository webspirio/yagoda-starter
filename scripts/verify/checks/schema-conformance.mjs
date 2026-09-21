#!/usr/bin/env node
/**
 * `28-db-schema.dbml` is the schema of record (root CLAUDE.md, "Domain") and until this
 * check nothing in the repository compared it to anything. This compares it, for the one
 * column class where a mismatch is silent money corruption: `numeric`.
 *
 * For every `numeric(p,s)` the DBML declares, three sources must agree:
 *   - the TypeORM `@Column` carries the same precision and the same scale, the same
 *     nullability and the same default, and its TypeScript property type is `string`
 *     (`string | null` when nullable) — NEVER `number`, which routes money through a
 *     float and rounds it where no test looks;
 *   - the migration's `CREATE TABLE` declares the same `numeric(p,s)`, the same NOT NULL
 *     and the same DEFAULT.
 *
 * AND IN REVERSE. A `numeric` column that exists in an entity or a migration and not in
 * the DBML is a finding too. A schema of record that is missing columns is not a record —
 * and that is the direction that was actually red when this check was written, on
 * `grade_prices.max_markup` and `grade_prices.max_discount`.
 *
 * SCOPED TO `numeric` DELIBERATELY. A full-column conformance check is red on six
 * documented, intentional divergences on day one (`grade_prices` has no `business_date`,
 * `users` has an extra `avatar_url`, and so on, each argued in its own entity header), and
 * the only way to green it is the line-keyed suppression baseline this layer refuses to
 * carry. The numeric subset had a finding set of size two, both genuinely wrong.
 *
 * DENY BY EXHAUSTION, NOT BY OMISSION. Anything this file cannot model is a finding, not a
 * skip: an unparsed line inside a `Table` block, a DBML table with no `@Entity`, an
 * `@Column({ name })` or a configured `namingStrategy` (either one breaks the
 * property-name-IS-column-name mapping every comparison here depends on), and any
 * `numeric`/`decimal` token in an `up()` SQL string the CREATE TABLE parser did not
 * consume — an `ALTER COLUMN … TYPE`, an `ADD COLUMN`, or a shape nobody has written yet.
 * That last one is a token-count reconciliation rather than a pattern list, so it fires on
 * SQL this check has never seen instead of waving it through.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { errMessage } from '../hash.mjs'
import {
  DBML_REL,
  backendSrcFiles,
  parseDbml,
  parseTsFile,
  readEntities,
} from '../lib/schema-map.mjs'
import { refuseEmptyScan, scanRoot } from '../scan-root.mjs'

/**
 * The tree this check scans. `--root <dir>` / VERIFY_SCAN_ROOT so its own fixtures are
 * `mkdtempSync` directories and never the real working tree.
 */
const ROOT = scanRoot()
const MIGRATIONS_REL = 'backend/src/migrations'
const NUMERIC_TYPE = /^(?:numeric|decimal)$/i
/** A `numeric` property is a STRING in TypeScript. These two forms, and nothing else. */
const NUMERIC_TS_TYPE = /^string(?: \| null)?$/
/** Where a TypeORM DataSource is configured, and therefore where a naming strategy would be. */
const DATA_SOURCE_FILES = ['backend/src/app.module.ts', 'backend/src/data-source.ts']

/**
 * @typedef {object} SqlColumn
 * @property {number} precision
 * @property {number} scale
 * @property {boolean} notNull
 * @property {string|null} default
 * @property {string} at
 */

/**
 * Every `numeric` CREATE TABLE column in every migration's `up()`, plus a finding for
 * every `numeric`/`decimal` token in one of those SQL strings that this parser did NOT
 * consume as such a column.
 *
 * Only `up()` is read: `down()` drops, and a dropped column has no shape to compare.
 *
 * @param {string} root
 * @returns {{ columns: Map<string, SqlColumn>, findings: string[] }}
 */
function readMigrations(root) {
  /** @type {Map<string, SqlColumn>} */
  const columns = new Map()
  /** @type {string[]} */
  const findings = []

  const migrationDir = path.join(root, MIGRATIONS_REL)
  const files = backendSrcFiles(root).filter(
    (f) => path.dirname(f) === migrationDir && f.endsWith('.ts') && !f.endsWith('.db-spec.ts'),
  )

  for (const file of files) {
    const sourceFile = parseTsFile(file)
    const rel = path.relative(root, file)
    /** @type {{ text: string, line: number }[]} */
    const sqls = []
    /** @param {ts.Node} node @returns {void} */
    const collect = (node) => {
      if (ts.isStringLiteralLike(node)) {
        sqls.push({
          text: node.text,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        })
      }
      ts.forEachChild(node, collect)
    }
    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement)) continue
      for (const member of statement.members) {
        if (ts.isMethodDeclaration(member) && member.name.getText(sourceFile) === 'up' && member.body) {
          collect(member.body)
        }
      }
    }

    for (const { text, line } of sqls) {
      let consumed = 0
      const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s*\(/i.exec(text)
      if (create) {
        const bodyStart = create.index + create[0].length
        const headLines = text.slice(0, bodyStart).split('\n').length - 1
        text
          .slice(bodyStart)
          .split('\n')
          .forEach((bodyLine, offset) => {
            const col = /^"?(\w+)"?\s+(numeric|decimal)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)(.*)$/i.exec(
              bodyLine.trim(),
            )
            if (!col) return
            consumed++
            const rest = col[5]
            columns.set(`${create[1]}.${col[1]}`, {
              precision: Number(col[3]),
              scale: Number(col[4]),
              notNull: /NOT\s+NULL/i.test(rest),
              default: /DEFAULT\s+([^,\s]+)/i.exec(rest)?.[1] ?? null,
              at: `${rel}:${line + headLines + offset}`,
            })
          })
      }
      const seen = (text.match(/\b(?:numeric|decimal)\b/gi) ?? []).length
      if (seen > consumed) {
        findings.push(
          `${rel}:${line}: ${seen - consumed} \`numeric\`/\`decimal\` token(s) in this SQL that ` +
            'the CREATE TABLE parser did not consume as a column (an ALTER COLUMN … TYPE? an ' +
            'ADD COLUMN?) — this check models CREATE TABLE only, and reports what it cannot ' +
            'model rather than passing over it.',
        )
      }
    }
  }

  return { columns, findings }
}

/**
 * @typedef {object} ScanResult
 * @property {string[]} findings
 * @property {number} dbmlTables
 * @property {number} dbmlNumeric
 * @property {number} entityFiles
 */

/**
 * @param {string} [root]
 * @returns {ScanResult}
 */
export function scan(root = ROOT) {
  const dbml = parseDbml(root)
  const entities = readEntities(root)
  const migrations = readMigrations(root)
  const findings = [...dbml.findings, ...migrations.findings]

  // A naming strategy rewrites property -> column, and every comparison below joins the
  // two by NAME. Teaching this check a strategy is possible; guessing at one is not.
  for (const rel of DATA_SOURCE_FILES) {
    /** @type {string} */
    let text
    try {
      text = readFileSync(path.join(root, rel), 'utf8')
    } catch {
      continue // the file need not exist in every tree this check is pointed at
    }
    if (/namingStrategy/.test(text)) {
      findings.push(
        `${rel}: a namingStrategy is configured — this check maps a column to an entity ` +
          'property by NAME, so a strategy that rewrites that mapping makes every comparison ' +
          'below a guess. Teach it the strategy or drop the strategy.',
      )
    }
  }

  /** @type {Map<string, import('../lib/schema-map.mjs').EntityColumn>} */
  const entityNumeric = new Map()
  for (const column of entities.columns) {
    if (column.nameOption !== null) {
      findings.push(
        `${column.at}: @Column({ name: '${column.nameOption}' }) on ${column.table}.${column.property} — ` +
          'this check joins a DBML column to an entity property by name, and a `name` option ' +
          'breaks that join silently. See this file\'s header.',
      )
    }
    if (NUMERIC_TYPE.test(column.type ?? '')) entityNumeric.set(`${column.table}.${column.property}`, column)
  }

  for (const table of dbml.tables) {
    if (!entities.dirs.has(table)) {
      findings.push(
        `${DBML_REL} declares table "${table}" and no @Entity('${table}') exists under ` +
          'backend/src — this check cannot compare a table it cannot find.',
      )
    }
  }

  for (const [key, want] of dbml.numeric) {
    const declared = `numeric(${want.precision},${want.scale})`
    const entity = entityNumeric.get(key)
    if (!entity) {
      findings.push(
        `${want.at}: ${key} is ${declared} in the schema of record — no matching \`numeric\` ` +
          '@Column in any *.entity.ts.',
      )
    } else {
      if (entity.precision !== want.precision || entity.scale !== want.scale) {
        findings.push(
          `${entity.at}: ${key} entity numeric(${entity.precision},${entity.scale}) != ` +
            `${DBML_REL} ${declared}.`,
        )
      }
      if (!NUMERIC_TS_TYPE.test(entity.tsType)) {
        findings.push(
          `${entity.at}: ${key} is ${declared} but its TypeScript property type is ` +
            `\`${entity.tsType}\` — a numeric column is a STRING; \`number\` routes money ` +
            'through a float and rounds it where no test looks.',
        )
      }
      if (entity.nullable === want.notNull) {
        findings.push(
          `${entity.at}: ${key} entity nullable=${entity.nullable}, ${DBML_REL} says ` +
            `${want.notNull ? 'not null' : 'nullable'}.`,
        )
      }
      if (entity.default !== want.default) {
        findings.push(
          `${entity.at}: ${key} entity default ${entity.default} != ${DBML_REL} default ${want.default}.`,
        )
      }
    }

    const sql = migrations.columns.get(key)
    if (!sql) {
      findings.push(
        `${want.at}: ${key} is ${declared} in the schema of record — no CREATE TABLE column ` +
          `for it under ${MIGRATIONS_REL}/.`,
      )
      continue
    }
    if (sql.precision !== want.precision || sql.scale !== want.scale) {
      findings.push(`${sql.at}: ${key} SQL numeric(${sql.precision},${sql.scale}) != ${DBML_REL} ${declared}.`)
    }
    if (sql.notNull !== want.notNull) {
      findings.push(
        `${sql.at}: ${key} SQL ${sql.notNull ? 'NOT NULL' : 'nullable'}, ${DBML_REL} says ` +
          `${want.notNull ? 'not null' : 'nullable'}.`,
      )
    }
    if (sql.default !== want.default) {
      findings.push(`${sql.at}: ${key} SQL DEFAULT ${sql.default} != ${DBML_REL} default ${want.default}.`)
    }
  }

  for (const [key, entity] of entityNumeric) {
    if (dbml.numeric.has(key)) continue
    findings.push(
      `${entity.at}: ${key} is numeric here and ${DBML_REL} — the schema of record — does not ` +
        'declare it. A record that is missing columns is not a record: add the column there.',
    )
  }
  for (const [key, sql] of migrations.columns) {
    if (dbml.numeric.has(key)) continue
    findings.push(
      `${sql.at}: ${key} is numeric in SQL and ${DBML_REL} — the schema of record — does not ` +
        'declare it. A record that is missing columns is not a record: add the column there.',
    )
  }

  return {
    findings,
    dbmlTables: dbml.tables.length,
    dbmlNumeric: dbml.numeric.size,
    entityFiles: entities.dirs.size,
  }
}

function main() {
  /** @type {ScanResult} */
  let result
  try {
    result = scan()
  } catch (err) {
    process.stderr.write(`schema: RED\n  ${errMessage(err)}\n`)
    process.exit(1)
    return
  }

  // Before any verdict, positive or negative: a run that read no schema and no entity has
  // nothing to say about either, and must not say it found nothing wrong.
  refuseEmptyScan('schema', result.dbmlTables, `tables in ${DBML_REL}`, ROOT)
  refuseEmptyScan('schema', result.entityFiles, 'backend/src @Entity classes', ROOT)

  if (result.findings.length > 0) {
    process.stderr.write('schema: RED\n')
    for (const finding of result.findings) process.stderr.write(`  ${finding}\n`)
    process.exit(1)
  }

  process.stdout.write(
    `schema: conformant — ${result.dbmlNumeric} numeric columns across ${result.dbmlTables} ` +
      `${DBML_REL} tables agree with their @Column and their CREATE TABLE on precision, scale, ` +
      'nullability and default, every one is typed `string`, and no entity or migration ' +
      'declares a numeric column the schema of record does not\n',
  )
}

if (process.argv[1]?.endsWith('schema-conformance.mjs')) main()
