#!/usr/bin/env node
/**
 * §2.7 freezes a recorded document's `amount`; §9.3 makes a correction a VOID plus a NEW
 * document. Today that holds by prose alone: no `@Patch` or `@Put` exists on any document
 * controller, and nothing whatsoever stops the first one from being written.
 *
 * THE SCOPE IS DERIVED, NEVER LISTED. A hand-written directory list is the artefact this
 * layer refuses to trust — a new document slice enters the repo and silently never enters
 * the check — and a marker decorator is worse, because the author who forgets `@Patch` is
 * the same author who forgets the marker. So the scope comes out of the schema of record,
 * in three mechanical hops:
 *
 *   1. `28-db-schema.dbml` — a table whose body declares a `voided_at` COLUMN is a
 *      voidable document. That is §9.3's own definition, read off the artefact that
 *      states it. A Note merely QUOTING `voided_at IS NULL` out of SQL is not a
 *      declaration, and the DBML does that far more often than it declares the column, so
 *      `parseDbml` anchors on the column line rather than the word.
 *   2. `@Entity('<table>')` under `backend/src/**\/*.entity.ts` maps that table to a
 *      directory.
 *   3. every `*.controller.ts` in that directory is in scope.
 *
 * Add a document table to the DBML and its controllers enter this check for free; delete
 * one and the scope shrinks with it. Nothing here is a filename anyone has to maintain,
 * and the derived scope is printed on every green run, so a narrowing is visible rather
 * than silent.
 *
 * AN EMPTY DERIVATION IS RED. Either hop can be made to match nothing by a rename, and a
 * check that scans nothing and reports "immutable" is the exact false green this layer
 * exists to refuse — so zero tables and zero controllers each refuse a verdict.
 *
 * `@Delete` is banned alongside `@Patch` and `@Put`: backend/CLAUDE.md states there is no
 * DELETE route anywhere in this API, and destroying a document is a stronger violation of
 * §9.3 than editing one.
 */
import path from 'node:path'
import ts from 'typescript'

import { errMessage } from '../hash.mjs'
import { DBML_REL, backendSrcFiles, decoratorNames, parseDbml, parseTsFile, readEntities } from '../lib/schema-map.mjs'
import { refuseEmptyScan, scanRoot } from '../scan-root.mjs'

/**
 * The tree this check scans. `--root <dir>` / VERIFY_SCAN_ROOT so its own fixtures are
 * `mkdtempSync` directories and never the real working tree.
 */
const ROOT = scanRoot()

/** The HTTP verbs that edit or destroy in place. Nest names them exactly these three. */
const BANNED_VERBS = new Set(['Patch', 'Put', 'Delete'])

/**
 * @typedef {object} ScanResult
 * @property {string[]} findings
 * @property {string[]} tables the voidable tables the DBML declares, sorted
 * @property {Map<string, string[]>} scope absolute controller path -> the tables that put
 *   it in scope
 */

/**
 * @param {string} [root]
 * @param {Set<string>} [banned] the verbs to refuse; a parameter ONLY so a test can swap
 *   it for a set the real tree is full of and prove this walk actually reaches the code
 * @returns {ScanResult}
 */
export function scan(root = ROOT, banned = BANNED_VERBS) {
  /** @type {string[]} */
  const findings = []
  const { voidable: tables } = parseDbml(root)
  const { dirs } = readEntities(root)
  const controllers = backendSrcFiles(root).filter((f) => f.endsWith('.controller.ts'))

  /** @type {Map<string, string[]>} */
  const scope = new Map()
  for (const table of tables) {
    const dir = dirs.get(table)
    if (dir === undefined) {
      findings.push(
        `${DBML_REL} declares a voided_at column on table '${table}' and no @Entity('${table}') ` +
          'exists under backend/src — hop 2 of this check\'s scope derivation cannot place it, ' +
          'so its controllers are unguarded.',
      )
      continue
    }
    for (const file of controllers) {
      if (path.dirname(file) !== dir) continue
      scope.set(file, (scope.get(file) ?? []).concat(table))
    }
  }

  for (const file of [...scope.keys()].sort()) {
    const sourceFile = parseTsFile(file)
    const rel = path.relative(root, file)
    /** @param {ts.Node} node @returns {void} */
    const visit = (node) => {
      if (ts.isMethodDeclaration(node) || ts.isClassDeclaration(node)) {
        for (const name of decoratorNames(node)) {
          if (!banned.has(name)) continue
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
          findings.push(
            `${rel}:${line}: @${name} on a document controller (${(scope.get(file) ?? []).join(', ')}) — ` +
              '§2.7 freezes a recorded document and §9.3 makes a correction a VOID plus a NEW ' +
              'document, so there is no in-place edit verb here.',
          )
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  return { findings, tables, scope }
}

function main() {
  /** @type {ScanResult} */
  let result
  try {
    result = scan()
  } catch (err) {
    process.stderr.write(`documents: RED\n  ${errMessage(err)}\n`)
    process.exit(1)
    return
  }

  // Both hops, before any verdict. A rename at either end silently empties this check, and
  // an empty check that prints "immutable" is worse than no check at all.
  refuseEmptyScan('documents', result.tables.length, `tables declaring a voided_at column in ${DBML_REL}`, ROOT)
  refuseEmptyScan('documents', result.scope.size, 'document controllers derived from those tables', ROOT)

  if (result.findings.length > 0) {
    process.stderr.write('documents: RED\n')
    for (const finding of result.findings) process.stderr.write(`  ${finding}\n`)
    process.exit(1)
  }

  process.stdout.write(
    `documents: immutable — no @Patch/@Put/@Delete on the ${result.scope.size} controller(s) ` +
      `derived from the ${result.tables.length} voidable table(s) ${DBML_REL} declares: ` +
      `${result.tables.join(', ')}\n`,
  )
}

if (process.argv[1]?.endsWith('document-immutability.mjs')) main()
