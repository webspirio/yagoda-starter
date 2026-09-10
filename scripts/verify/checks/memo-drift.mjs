#!/usr/bin/env node
/**
 * The memo's proves/does-not-prove table must match the registry exactly.
 *
 * Drift between those two artifacts is a defect in the one pair whose entire job is
 * honesty: if CLAUDE.md claims a check proves something it no longer proves, the memo has
 * become the false-confidence artifact it was written to remove. So the table is
 * generated, not written, and this check compares it byte for byte.
 *
 * `--write` regenerates the region between the markers in CLAUDE.md.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

import { CHECKS } from '../registry.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const MEMO = path.join(ROOT, 'CLAUDE.md')

const BEGIN = '<!-- BEGIN:verify-table -->'
const END = '<!-- END:verify-table -->'

/**
 * Escaped for a markdown table cell.
 *
 * Throws on an embedded marker: `indexOf(END)` would find the injected copy instead of the
 * real one, and `--write` would append another marker every run and never converge.
 *
 * @param {string} s
 * @returns {string}
 */
function cell(s) {
  if (s.includes('BEGIN:verify-table') || s.includes('END:verify-table')) {
    throw new Error(`registry string contains a table marker — this would break CLAUDE.md: ${s.slice(0, 60)}`)
  }
  return s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

/** @returns {string} */
function renderTable() {
  const lines = [
    BEGIN,
    '<!-- Generated from scripts/verify/registry.mjs. Do not hand-edit:',
    '     the `memo` check compares this block byte for byte and fails on any divergence.',
    '     To change the text, edit registry.mjs, then run',
    '     `node scripts/verify/checks/memo-drift.mjs --write`. -->',
    '',
    '| check | tier | proves | does NOT prove |',
    '| --- | --- | --- | --- |',
  ]
  for (const c of CHECKS) {
    const needs = c.needs?.length ? ` (needs: ${cell(c.needs.join(', '))})` : ''
    const after = c.after?.length ? ` (after: ${cell(c.after.join(', '))})` : ''
    lines.push(
      `| \`${c.id}\` | ${c.tier}${needs}${after} | ${cell(c.proves)} | ${cell(c.blindSpot)} |`,
    )
  }
  // A checksum over the RAW strings. cell() collapses whitespace, so two different registry
  // strings could render to one identical table cell — and the "byte-for-byte" claim would
  // then hold of the table while the registry had changed underneath it.
  //
  // Fields and rows are joined on control characters built via fromCharCode (never typed
  // literally in this file) so no combination of field values can collide onto the same
  // digest as a different combination would.
  const FIELD_SEP = String.fromCharCode(0)
  const ROW_SEP = String.fromCharCode(1)
  const raw = CHECKS.map((c) =>
    [c.id, c.tier, (c.needs ?? []).join(','), (c.after ?? []).join(','), c.proves, c.blindSpot].join(FIELD_SEP),
  ).join(ROW_SEP)
  lines.push('', `<!-- registry-checksum: ${createHash('sha256').update(raw).digest('hex').slice(0, 32)} -->`)
  lines.push(END)
  return lines.join('\n')
}

function main() {
  const write = process.argv.includes('--write')
  let memo
  try {
    memo = readFileSync(MEMO, 'utf8')
  } catch {
    process.stderr.write(`memo: RED\n  missing ${path.relative(ROOT, MEMO)}\n`)
    process.exit(1)
  }

  const start = memo.indexOf(BEGIN)
  const end = memo.indexOf(END)
  if (start === -1 || end === -1 || end < start) {
    process.stderr.write(
      `memo: RED\n  CLAUDE.md has no ${BEGIN} … ${END} markers.\n` +
        `  Without them the table cannot be generated, and so cannot fail to match the registry.\n`,
    )
    process.exit(1)
  }

  const current = memo.slice(start, end + END.length)
  const expected = renderTable()

  if (write) {
    if (current === expected) {
      process.stdout.write('memo: table is already up to date\n')
      return
    }
    writeFileSync(MEMO, memo.slice(0, start) + expected + memo.slice(end + END.length))
    process.stdout.write(`memo: table regenerated (${CHECKS.length} rows)\n`)
    return
  }

  if (current !== expected) {
    // Show the first differing line: a whole-table diff is unreadable and gets skimmed.
    const a = current.split('\n')
    const b = expected.split('\n')
    let i = 0
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i += 1
    process.stderr.write(
      `memo: RED\n` +
        `  The table in CLAUDE.md has drifted from scripts/verify/registry.mjs (line ${i + 1}).\n` +
        `  CLAUDE.md has: ${a[i] ?? '(no line)'}\n` +
        `  registry has:  ${b[i] ?? '(no line)'}\n` +
        `  Fix: node scripts/verify/checks/memo-drift.mjs --write\n`,
    )
    process.exit(1)
  }

  process.stdout.write(
    `memo: the proves/does-not-prove table matches the registry — ${CHECKS.length} rows\n`,
  )
}

main()
