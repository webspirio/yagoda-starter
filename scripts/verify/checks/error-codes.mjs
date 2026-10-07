#!/usr/bin/env node
/**
 * Every error code the backend can send is one the frontend knows, and every code the
 * frontend names is one the backend still sends.
 *
 * A code is any UPPER_SNAKE string literal in shipped backend source — `code: 'X'`,
 * `assertTrimmedName(…, 'X')`, `bad(msg, 'X')` alike — and a frontend reference is the same
 * shape as a string literal or an object key in shipped frontend source. A code with no
 * reference reaches the user as a generic «не вдалося»; a reference with no code is a
 * mapping that silently stopped matching. What is neither lives in ONE reviewed file,
 * scripts/verify/baselines/error-codes.json, dated and reasoned, and must still match.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { errMessage } from '../hash.mjs'
import { CODE_NAME, listUnder, scanFrontend } from '../lib/frontend-i18n.mjs'
import { refuseEmptyScan, scanRoot } from '../scan-root.mjs'

const ROOT = scanRoot()
const BASELINE_REL = 'scripts/verify/baselines/error-codes.json'
const NOT_SHIPPED = /(spec\.ts$|^backend\/src\/(testing|migrations|seed)\/)/

/** @param {string} root */
export function backendCodes(root) {
  const files = listUnder(root, 'backend/src').filter((f) => f.endsWith('.ts') && !NOT_SHIPPED.test(f))
  /** @type {Set<string>} */
  const codes = new Set()
  /** @type {string[]} */
  const scanned = []
  for (const rel of files) {
    let text
    try {
      text = readFileSync(path.join(root, rel), 'utf8')
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') continue
      throw err
    }
    scanned.push(rel)
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
    /** @param {ts.Node} n */
    const visit = (n) => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && CODE_NAME.test(n.text)) codes.add(n.text)
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return { files: scanned, codes }
}

/**
 * @param {Set<string>} backend
 * @param {Set<string>} frontend
 * @param {unknown} baseline parsed JSON
 */
export function checkErrorCodes(backend, frontend, baseline) {
  /** @type {string[]} */
  const problems = []
  if (!Array.isArray(baseline)) return { problems: [`${BASELINE_REL} must be a JSON array`], excused: 0 }
  /** @type {Set<string>} */
  const excused = new Set()
  for (const e of baseline) {
    const label = `${BASELINE_REL}: ${e?.code ?? '<no code>'}`
    if (typeof e?.code !== 'string') problems.push(`${label}: "code" must be a string`)
    else if (typeof e.reason !== 'string' || e.reason.trim() === '') problems.push(`${label}: "reason" is missing or empty`)
    else if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) problems.push(`${label}: "date" must be YYYY-MM-DD`)
    else excused.add(e.code)
  }
  const unmapped = [...backend].filter((c) => !frontend.has(c))
  const orphaned = [...frontend].filter((c) => !backend.has(c))
  for (const c of unmapped) if (!excused.has(c)) problems.push(`${c}: thrown in backend/src, no frontend reference — map it where it surfaces, or excuse it in ${BASELINE_REL}`)
  for (const c of orphaned) if (!excused.has(c)) problems.push(`${c}: named in frontend source, never produced by backend/src`)
  const live = new Set([...unmapped, ...orphaned])
  for (const c of excused) if (!live.has(c)) problems.push(`stale exception — ${c} needs no excuse any more, delete it from ${BASELINE_REL}`)
  return { problems: problems.sort(), excused: excused.size }
}

/** @param {string} root @returns {unknown} */
function readBaseline(root) {
  const abs = path.join(root, BASELINE_REL)
  if (!existsSync(abs)) return []
  try {
    return JSON.parse(readFileSync(abs, 'utf8'))
  } catch (err) {
    throw new Error(`${BASELINE_REL} is not valid JSON: ${errMessage(err)}`)
  }
}

function main() {
  let backend, frontend, result
  try {
    backend = backendCodes(ROOT)
    frontend = scanFrontend(ROOT)
    result = checkErrorCodes(backend.codes, new Set(frontend.names), readBaseline(ROOT))
  } catch (err) {
    process.stderr.write(`error-codes: RED\n  ${errMessage(err)}\n`)
    process.exit(1)
    return
  }
  refuseEmptyScan('error-codes', backend.files.length, 'backend source files', ROOT)
  refuseEmptyScan('error-codes', frontend.files.length, 'frontend source files', ROOT)
  refuseEmptyScan('error-codes', backend.codes.size, 'backend error codes', ROOT)

  if (result.problems.length) {
    process.stderr.write('error-codes: RED\n')
    for (const p of result.problems) process.stderr.write(`  ${p}\n`)
    process.exit(1)
  }
  process.stdout.write(
    `error-codes: all ${backend.codes.size} backend error codes are named in ${frontend.files.length} frontend source files ` +
      `or excused (${result.excused} in the baseline), and every frontend code name is one the backend produces\n`,
  )
}

if (process.argv[1]?.endsWith('error-codes.mjs')) main()
