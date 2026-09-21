/**
 * THE ONE PLACE A REPORT THIS RUNNER ACTUALLY WROTE MEETS ITS CONSUMERS.
 *
 * Every other test of the report shape builds the report by hand — run.test.mjs imports
 * pure functions and never spawns the CLI, and stop-gate.test.mjs fabricates its payload.
 * So both sides of the contract were invented by the same author, and renaming `checks` in
 * run.mjs left all 166 tests green while `.claude/hooks/stop-gate.mjs` exited 0 on a red
 * tree, forever. That is the gap this file exists to close, and nothing else can: a key
 * list that every side DERIVES from is a contract with one source of truth and no
 * independent witness.
 *
 * Hence the two deliberate un-tidinesses below, both of which must survive review:
 *   - `report.checks` and `report.scope.only` are spelled as LITERALS, not read out of
 *     REPORT_KEYS. Deriving them makes the assertion self-referential and a consistent
 *     rename of both sides of run.mjs sails straight through.
 *   - the gate's own source is read and matched for `report.checks`, because that is the
 *     only assertion here that fails when the runner is renamed consistently and
 *     .claude/hooks/stop-gate.mjs is simply forgotten.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { REPORT_KEYS, reportIsFresh } from './run.mjs'

const RUN = path.join(import.meta.dirname, 'run.mjs')
const GATE = path.resolve(import.meta.dirname, '..', '..', '.claude', 'hooks', 'stop-gate.mjs')

/**
 * `testfiles` is the cheapest row that can stand in for "a real run": it declares no
 * preconditions, reads only git's file list and two jest configs, writes nothing, and — the
 * property that matters — RUNS NO TESTS, so this file executing inside `selfcheck` cannot
 * recurse into itself. `memo` is going away, `migrations` needs origin/main in fact though
 * not in its `needs`, and `test`/`selfcheck` would recurse.
 */
const ROW = 'testfiles'

test('the REAL runner emits exactly the keys REPORT_KEYS declares', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'verify-report-'))
  try {
    const stdout = execFileSync(process.execPath, [RUN, '--only', ROW, '--json'], {
      encoding: 'utf8',
      // Without this the spawned runner overwrites the real .verify/last-run.json — the
      // very report the Stop gate replays — and because .verify/ is gitignored it would do
      // so with `git status` staying clean.
      env: { ...process.env, VERIFY_REPORT_DIR: out },
      timeout: 60_000,
    })
    const report = JSON.parse(stdout)

    assert.deepEqual(Object.keys(report).sort(), [...REPORT_KEYS.top].sort())
    assert.deepEqual(Object.keys(report.scope).sort(), [...REPORT_KEYS.scope].sort())
    assert.ok(report.checks.length > 0, 'a --only run must still produce a row')
    for (const row of report.checks) {
      assert.deepEqual(Object.keys(row).sort(), [...REPORT_KEYS.check].sort())
    }

    // The gate's own read, spelled the way the gate spells it.
    assert.ok(Array.isArray(report.checks), 'stop-gate.mjs reads report.checks')

    // The report actually landed where it was told to, and nowhere else.
    const onDisk = JSON.parse(readFileSync(path.join(out, 'last-run.json'), 'utf8'))
    assert.equal(onDisk.sourceHash, report.sourceHash)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('reportIsFresh refuses a REAL narrow report, and only because it is narrow', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'verify-report-'))
  try {
    const stdout = execFileSync(process.execPath, [RUN, '--only', ROW, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, VERIFY_REPORT_DIR: out },
      timeout: 60_000,
    })
    const report = JSON.parse(stdout)
    const opts = { tier: /** @type {'fast'} */ ('fast'), noSkip: false }

    assert.equal(
      reportIsFresh(report, report.sourceHash, opts),
      false,
      'a one-check green is not a verdict on the tree',
    )

    // THE DISCRIMINATOR. Without it this test passes when reportIsFresh refuses the report
    // for some unrelated mismatch — "my fixture was correctly rejected" is indistinguishable
    // from "my fixture was never really examined". Putting `only` back must flip it, which
    // means every OTHER freshness field of a report the runner actually wrote lines up.
    assert.equal(
      reportIsFresh({ ...report, scope: { ...report.scope, only: null } }, report.sourceHash, opts),
      true,
      'every other freshness field of a REAL report must line up',
    )
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('stop-gate.mjs still reads the key the runner still writes', () => {
  // Three lines, no spawn, and the only assertion in the repo that fails when BOTH sides of
  // run.mjs are renamed consistently and the gate is forgotten.
  const gate = readFileSync(GATE, 'utf8')
  assert.match(
    gate,
    /\breport\??\.checks\b/,
    'stop-gate.mjs no longer reads report.checks — the gate and the runner have diverged, ' +
      'which makes the gate exit 0 on a red tree rather than blocking',
  )
})
