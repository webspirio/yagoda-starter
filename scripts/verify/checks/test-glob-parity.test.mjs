import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'checks', 'test-glob-parity.mjs')

function run() {
  try {
    return { status: 0, out: execFileSync(process.execPath, [CHECK], { encoding: 'utf8' }) }
  } catch (err) {
    // Cast is needed for `npx tsc -p tsconfig.scripts.json` (strict + checkJs types catch
    // variables as `unknown`) — same idiom as memo-drift.test.mjs's run() helper. Runtime
    // behaviour is unchanged from the brief's verbatim version.
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

test('the real tree is green', () => {
  assert.equal(run().status, 0)
})

test('a backend *.test.ts is caught — no runner collects it', () => {
  const orphan = path.join(ROOT, 'backend', 'src', 'zz-orphan.test.ts')
  writeFileSync(orphan, 'it("never runs", () => {})\n')
  try {
    const res = run()
    assert.equal(res.status, 1)
    assert.match(res.out, /zz-orphan\.test\.ts/)
    assert.match(res.out, /no runner|zero/i)
  } finally {
    rmSync(orphan, { force: true })
  }
})

test('a frontend *.spec.tsx collected by vitest alone is fine', () => {
  const ok = path.join(ROOT, 'frontend', 'src', 'zz-ok.spec.tsx')
  writeFileSync(ok, 'it("runs", () => {})\n')
  try {
    assert.equal(run().status, 0)
  } finally {
    rmSync(ok, { force: true })
  }
})

test('a .claude/hooks/*.test.mjs file is collected by node-test (Task 19)', () => {
  // Before Task 19 taught collectorsFor() about .claude/hooks/, a file here matched zero
  // collectors and would have failed as an ORPHAN — the same failure mode as the backend
  // *.test.ts fixture above, one directory over.
  const ok = path.join(ROOT, '.claude', 'hooks', 'zz-ok.test.mjs')
  writeFileSync(ok, "import { test } from 'node:test'\ntest('runs', () => {})\n")
  try {
    assert.equal(run().status, 0)
  } finally {
    rmSync(ok, { force: true })
  }
})

test('a scripts/ci/*.test.sh file is collected by shell-test (Task 21)', () => {
  // Before Task 21 taught both CANDIDATE_FILE's companion SHELL_TEST_FILE net and
  // collectorsFor() about scripts/ci/, a .sh file was invisible to this check on BOTH
  // sides — not even a candidate, so it could never be reported as an orphan either. This
  // is the exact gap a whole-branch review found by hand in origin/main's `checks` job.
  const ok = path.join(ROOT, 'scripts', 'ci', 'zz-ok.test.sh')
  writeFileSync(ok, '#!/usr/bin/env bash\necho ok\n')
  try {
    assert.equal(run().status, 0)
  } finally {
    rmSync(ok, { force: true })
  }
})

test('a *.test.sh file outside scripts/ci/ is an orphan — the candidate net is wider than the collector', () => {
  // SHELL_TEST_FILE (the candidate net) matches *.test.sh anywhere; the shell-test
  // COLLECTOR only claims scripts/ci/*.test.sh. A .test.sh file elsewhere is therefore a
  // candidate with zero collectors — an ORPHAN — rather than silently invisible.
  const orphan = path.join(ROOT, 'scripts', 'zz-orphan.test.sh')
  writeFileSync(orphan, '#!/usr/bin/env bash\necho never run\n')
  try {
    const res = run()
    assert.equal(res.status, 1)
    assert.match(res.out, /zz-orphan\.test\.sh/)
    assert.match(res.out, /no runner|zero/i)
  } finally {
    rmSync(orphan, { force: true })
  }
})
