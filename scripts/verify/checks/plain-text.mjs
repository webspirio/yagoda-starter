#!/usr/bin/env node
/**
 * No untranslated text in shipped UI code. A literal the user reads belongs in a locale file
 * and reaches the screen through t(); anything else renders in one language for everyone.
 *
 * What counts as "text" is lib/frontend-i18n.mjs's four rules. What is excused lives in ONE
 * reviewed file, scripts/verify/baselines/plain-text.json — never an inline comment, which
 * nobody reviews as an exception and an agent writes faster than a t() call. An entry must
 * still match something, so an exception disappears with the finding it excused.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { errMessage } from '../hash.mjs'
import { normalise, scanFrontend } from '../lib/frontend-i18n.mjs'
import { refuseEmptyScan, scanRoot } from '../scan-root.mjs'

const ROOT = scanRoot()
const BASELINE_REL = 'scripts/verify/baselines/plain-text.json'

/**
 * @typedef {import('../lib/frontend-i18n.mjs').Candidate} Candidate
 * @typedef {{ file: string, text?: string, date: string, reason: string }} Exception
 */

/**
 * @param {unknown} raw parsed baseline JSON
 * @returns {{ entries: Exception[], problems: string[] }}
 */
export function validateExceptions(raw) {
  if (!Array.isArray(raw)) return { entries: [], problems: [`${BASELINE_REL} must be a JSON array`] }
  /** @type {Exception[]} */
  const entries = []
  /** @type {string[]} */
  const problems = []
  for (const e of raw) {
    const label = `${BASELINE_REL}: ${e?.file ?? '<no file>'}${e?.text ? ` "${e.text}"` : ''}`
    if (typeof e?.file !== 'string' || (e.text !== undefined && typeof e.text !== 'string')) {
      problems.push(`${label}: "file" must be a string, "text" a string when present`)
    } else if (typeof e.reason !== 'string' || e.reason.trim().length < 30) {
      problems.push(`${label}: "reason" is missing or shorter than 30 characters`)
    } else if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
      problems.push(`${label}: "date" must be YYYY-MM-DD`)
    } else {
      entries.push(e)
    }
  }
  return { entries, problems }
}

/** @param {Exception} e @param {Candidate} c */
const covers = (e, c) => e.file === c.file && (e.text === undefined || normalise(e.text) === c.text)

/**
 * @param {Candidate[]} candidates
 * @param {Exception[]} entries
 * @returns {{ findings: Candidate[], stale: Exception[] }}
 */
export function applyExceptions(candidates, entries) {
  return {
    findings: candidates.filter((c) => !entries.some((e) => covers(e, c))),
    stale: entries.filter((e) => !candidates.some((c) => covers(e, c))),
  }
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

/** @param {string} [root] */
function scan(root = ROOT) {
  const { files, candidates } = scanFrontend(root)
  const { entries, problems } = validateExceptions(readBaseline(root))
  return { files, problems, ...applyExceptions(candidates, entries) }
}

function main() {
  let result
  try {
    result = scan()
  } catch (err) {
    process.stderr.write(`plain-text: RED\n  ${errMessage(err)}\n`)
    process.exit(1)
    return
  }
  refuseEmptyScan('plain-text', result.files.length, 'frontend source files', ROOT)

  const { files, findings, stale, problems } = result
  if (findings.length || stale.length || problems.length) {
    process.stderr.write('plain-text: RED\n')
    for (const p of problems) process.stderr.write(`  ${p}\n`)
    for (const s of stale) {
      process.stderr.write(`  stale exception — matches nothing, delete it: ${s.file}${s.text ? ` "${s.text}"` : ''}\n`)
    }
    for (const f of findings) process.stderr.write(`  ${f.file}:${f.line}:${f.col}  ${f.rule}  "${f.text}"\n`)
    if (findings.length) {
      process.stderr.write(
        '  Move each text into frontend/src/shared/lib/i18n/locales/{en,uk}.json and render it with t(). ' +
          `Only text no production user reads as a phrase may go in ${BASELINE_REL}, dated and reasoned.\n`,
      )
    }
    process.exit(1)
  }
  process.stdout.write(`plain-text: no untranslated text across ${files.length} frontend source files\n`)
}

if (process.argv[1]?.endsWith('plain-text.mjs')) main()
