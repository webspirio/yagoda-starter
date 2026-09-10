/**
 * stop-gate.mjs is the only blocking layer in this repo, so it is tested by actually
 * DRIVING it: a real child process, synthetic JSON on stdin, and a stubbed
 * `scripts/verify/run.mjs` — never an in-process import of its internals. The file has no
 * exports and executes `main()` unconditionally at load time (exactly like the production
 * hook Claude Code spawns), so a child process is the only way to observe one run in
 * isolation without one test's stdin/counter state leaking into the next.
 *
 * The stub runner is ONE file, reused by every scenario below and driven entirely by
 * `STUB_STATUS`/`STUB_STDOUT`/`STUB_STDERR` environment variables — stop-gate.mjs passes
 * `env: process.env` straight through to the child it spawns, so whatever this test sets
 * before calling `runGate()` reaches the stub untouched.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const GATE = path.join(ROOT, '.claude', 'hooks', 'stop-gate.mjs')

const STUB_RUNNER = [
  '#!/usr/bin/env node',
  '// Driven entirely by environment variables — see stop-gate.test.mjs for why.',
  'import { readFileSync } from "node:fs"',
  '// exitCode, never exit(): the same pipe-truncation hazard run.mjs\'s own header comment',
  '// warns about — process.exit() right after a large stdout.write() can terminate the',
  '// process before an asynchronous pipe write finishes flushing, truncating the very',
  '// payload the huge-report test below depends on arriving intact.',
  'process.exitCode = Number(process.env.STUB_STATUS ?? "0")',
  '// A huge payload goes through a FILE, never the STUB_STDOUT variable itself: stuffing',
  '// 200KB into an environment variable blows past the OS argv+env size limit (E2BIG) on',
  '// the spawnSync call that starts THIS process — a limit of the test harness, not of',
  '// stop-gate.mjs, which never puts run.mjs\'s report through an env var at all.',
  'const stdoutFile = process.env.STUB_STDOUT_FILE',
  'process.stdout.write(stdoutFile ? readFileSync(stdoutFile, "utf8") : (process.env.STUB_STDOUT ?? ""))',
  'process.stderr.write(process.env.STUB_STDERR ?? "")',
  '',
].join('\n')

/**
 * A throwaway project root shaped just enough for stop-gate.mjs to run against: it reads
 * `CLAUDE_PROJECT_DIR` as its ROOT and spawns `<ROOT>/scripts/verify/run.mjs` — this
 * fixture supplies both.
 *
 * @returns {string}
 */
function fixtureRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'stop-gate-'))
  mkdirSync(path.join(root, 'scripts', 'verify'), { recursive: true })
  writeFileSync(path.join(root, 'scripts', 'verify', 'run.mjs'), STUB_RUNNER)
  return root
}

/**
 * @param {(root: string) => void} fn
 * @returns {void}
 */
function withRoot(fn) {
  const root = fixtureRoot()
  try {
    fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/**
 * @typedef {{id: string, status: string, reason?: string}} StubCheckRow
 */

/** A fast-tier `--json` report shaped like the real run.mjs's output. @param {StubCheckRow[]} checks @returns {string} */
function report(checks) {
  return JSON.stringify({
    schema: 1,
    tier: 'fast',
    sourceHash: 'deadbeefcafefeed0000000000000000000000000000000000000000000000',
    ok: checks.every((c) => c.status !== 'FAILED'),
    checks,
  })
}

/**
 * @typedef {object} GateResult
 * @property {number} status
 * @property {string} stdout
 * @property {string} stderr
 * @property {Record<string, unknown> | null} json  parsed stdout, when stdout carried
 *   exactly one JSON line (asserted here, not left to each test to re-check)
 */

/**
 * Runs the REAL `.claude/hooks/stop-gate.mjs` as its own process: synthetic stdin in,
 * exit code / stdout / stderr out. This is the exact mechanism Claude Code invokes.
 *
 * @param {{
 *   root: string,
 *   input?: Record<string, unknown>,
 *   stdin?: string,
 *   stubStatus?: number,
 *   stubStdout?: string,
 *   stubStdoutFile?: string,
 *   stubStderr?: string,
 * }} opts
 * @returns {GateResult}
 */
function runGate({ root, input, stdin, stubStatus = 0, stubStdout = '', stubStdoutFile, stubStderr = '' }) {
  const stdinText = stdin !== undefined ? stdin : input !== undefined ? JSON.stringify(input) : ''
  const res = spawnSync(process.execPath, [GATE], {
    cwd: root,
    input: stdinText,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      STUB_STATUS: String(stubStatus),
      STUB_STDOUT: stubStdout,
      ...(stubStdoutFile ? { STUB_STDOUT_FILE: stubStdoutFile } : {}),
      STUB_STDERR: stubStderr,
      // Never let a warning meant for the ADVISORY hooks (node.sh's VERIFY_HOOK_WARN)
      // leak into the gate's own systemMessage and confuse an assertion below.
      VERIFY_HOOK_WARN: '',
    },
  })
  const lines = (res.stdout ?? '').split('\n').filter((l) => l.length > 0)
  // Non-negotiable, checked on every single call: exactly one JSON object may ever reach
  // stdout. Two would corrupt the protocol; this fails loudly the moment any scenario
  // below produces a second line, rather than only checking it on the scenarios that
  // remembered to ask.
  assert.ok(lines.length <= 1, `stdout must carry at most one line, got ${lines.length}:\n${res.stdout}`)
  /** @type {Record<string, unknown> | null} */
  let json = null
  if (lines.length === 1) {
    json = JSON.parse(lines[0])
  }
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '', json }
}

// ---------------------------------------------------------------------------------------
// 1. green tree
// ---------------------------------------------------------------------------------------

test('1. green tree: exit 0, no block, nothing on stdout', () => {
  withRoot((root) => {
    const res = runGate({
      root,
      input: { prompt_id: 'p-green' },
      stubStatus: 0,
      stubStdout: report([
        { id: 'lint', status: 'PASSED' },
        { id: 'typecheck', status: 'PASSED' },
      ]),
    })
    assert.equal(res.status, 0)
    // Nothing to say: --reuse-if-fresh's real green-with-no-skip path emits nothing at
    // all (see the gate's own comment on that branch), so an empty stdout is the correct
    // "no block" signal here, not merely an acceptable one.
    assert.equal(res.json, null)
  })
})

// ---------------------------------------------------------------------------------------
// 2. red tree
// ---------------------------------------------------------------------------------------

test('2. red tree: exit 2, failure table on stderr, both block shapes on stdout, no continue:false / stopReason', () => {
  withRoot((root) => {
    const res = runGate({
      root,
      input: { prompt_id: 'p-red' },
      stubStatus: 1,
      stubStdout: report([
        { id: 'lint', status: 'FAILED', reason: '2 errors in health.controller.ts' },
        { id: 'typecheck', status: 'PASSED' },
      ]),
    })
    assert.equal(res.status, 2)
    assert.ok(res.json, 'stdout must carry exactly one JSON object')
    const j = /** @type {any} */ (res.json)
    assert.equal(j.hookSpecificOutput?.hookEventName, 'Stop')
    assert.equal(j.hookSpecificOutput?.decision, 'block')
    assert.equal(typeof j.hookSpecificOutput?.reason, 'string')
    assert.equal(j.decision, 'block')
    assert.equal(typeof j.reason, 'string')
    // The exact clause the docs credit with overriding a Stop block into a full session
    // halt. Neither key may be present, spelled correctly or not, under any value.
    assert.equal('continue' in j, false)
    assert.equal('stopReason' in j, false)
    assert.match(res.stderr, /Fast tier is RED/)
    assert.match(res.stderr, /lint/)
    assert.match(res.stderr, /2 errors in health\.controller\.ts/)
    assert.match(res.stderr, /Fix the cause, not the check/)
    assert.match(res.stderr, /CLAUDE\.md, rule 3/)
  })
})

// ---------------------------------------------------------------------------------------
// 3. third consecutive block on the same prompt_id
// ---------------------------------------------------------------------------------------

test('3. a third consecutive block on the same prompt_id releases the cap instead of blocking again', () => {
  withRoot((root) => {
    const redOpts = {
      root,
      input: { prompt_id: 'p-cap' },
      stubStatus: 1,
      stubStdout: report([{ id: 'lint', status: 'FAILED', reason: 'boom' }]),
    }
    const first = runGate(redOpts)
    assert.equal(first.status, 2, 'attempt 1 blocks')
    const second = runGate(redOpts)
    assert.equal(second.status, 2, 'attempt 2 blocks')
    const third = runGate(redOpts)
    assert.equal(third.status, 0, 'attempt 3 releases the cap — an uncapped block would deadlock the agent')
    assert.ok(third.json)
    const j = /** @type {any} */ (third.json)
    assert.equal(j.decision, undefined, 'the release must not itself be a block')
    assert.match(String(j.systemMessage), /already 2 block\(s\)/)
    assert.match(String(j.systemMessage), /MUST start your reply/)
    assert.match(String(j.systemMessage), /checks are red/i)
  })
})

test('reset on green: a passing run clears the counter, so the cap does not carry into the next red streak', () => {
  withRoot((root) => {
    const red = {
      root,
      input: { prompt_id: 'p-reset' },
      stubStatus: 1,
      stubStdout: report([{ id: 'lint', status: 'FAILED', reason: 'x' }]),
    }
    const green = {
      root,
      input: { prompt_id: 'p-reset' },
      stubStatus: 0,
      stubStdout: report([{ id: 'lint', status: 'PASSED' }]),
    }
    assert.equal(runGate(red).status, 2, 'block 1')
    assert.equal(runGate(green).status, 0, 'a green run in between resets the counter')
    assert.equal(runGate(red).status, 2, 'block 1 again, not the capped release')
    assert.equal(runGate(red).status, 2, 'block 2')
    assert.equal(runGate(red).status, 0, 'block 3 is the release, counting only since the last green')
  })
})

// ---------------------------------------------------------------------------------------
// 4. no prompt_id
// ---------------------------------------------------------------------------------------

test('4. no prompt_id: exit 0, states the red result, does not block', () => {
  withRoot((root) => {
    const res = runGate({
      root,
      input: {},
      stubStatus: 1,
      stubStdout: report([{ id: 'lint', status: 'FAILED', reason: 'boom' }]),
    })
    assert.equal(res.status, 0)
    assert.ok(res.json)
    const j = /** @type {any} */ (res.json)
    assert.equal(j.decision, undefined, 'an uncapped block would deadlock the agent, so this must not block')
    assert.match(res.stderr, /no prompt_id\/session_id/)
    assert.match(String(j.systemMessage), /with no prompt_id/i)
    assert.match(String(j.systemMessage), /boom/, 'the red detail must still be stated, just not enforced')
  })
})

test('a session_id with no prompt_id is NOT used as a substitute counter key', () => {
  // C3 in the reference: falling back to session_id (stable across turns, while reset()
  // only fires on green) saturates the counter on turn 1 of a persistently red tree and
  // silently stops blocking for the rest of the session. Proven here by running the same
  // "session_id only" input three times: a session_id-keyed counter would show attempt 3
  // as the capped release (status 0); the actual behaviour is the no-id path every time.
  withRoot((root) => {
    const opts = {
      root,
      input: { session_id: 'same-session-every-time' },
      stubStatus: 1,
      stubStdout: report([{ id: 'lint', status: 'FAILED', reason: 'boom' }]),
    }
    for (let i = 0; i < 3; i += 1) {
      const res = runGate(opts)
      assert.equal(res.status, 0, `attempt ${i + 1} must take the no-id path, not a counted block`)
      const j = /** @type {any} */ (res.json)
      assert.match(res.stderr, /no prompt_id\/session_id/)
      assert.match(String(j.systemMessage), /with no prompt_id/i)
    }
    // No counter file was ever created for a session_id.
    const counterDir = path.join(root, '.verify', 'gate-counter')
    assert.throws(() => readdirSync(counterDir), /ENOENT/)
  })
})

// ---------------------------------------------------------------------------------------
// 5. unwritable counter directory
// ---------------------------------------------------------------------------------------

test('5. unwritable counter directory: exit 0, does not block, says why', () => {
  withRoot((root) => {
    // `.verify` is created as a FILE, not a directory, so mkdirSync(COUNTER_DIR, ...)
    // fails with ENOTDIR. Chosen over chmod 000 because it fails identically regardless
    // of which user runs the suite (chmod affords no protection to a root-run test).
    writeFileSync(path.join(root, '.verify'), 'not a directory')
    const res = runGate({
      root,
      input: { prompt_id: 'p-unwritable' },
      stubStatus: 1,
      stubStdout: report([{ id: 'lint', status: 'FAILED', reason: 'boom' }]),
    })
    assert.equal(res.status, 0)
    assert.ok(res.json)
    const j = /** @type {any} */ (res.json)
    assert.equal(j.decision, undefined, 'an unbounded block would be a deadlock between the gate and the agent')
    assert.match(res.stderr, /could not write the block counter/)
    assert.match(String(j.systemMessage), /counter cannot be written/)
    assert.match(String(j.systemMessage), /boom/, 'the red detail must still be stated, just not enforced')
  })
})

// ---------------------------------------------------------------------------------------
// 6. runner emits unparseable output
// ---------------------------------------------------------------------------------------

test('6. runner emits unparseable output: exit 0, fails open and loudly, says UNVERIFIED, never claims the tree is red', () => {
  withRoot((root) => {
    const res = runGate({
      root,
      input: { prompt_id: 'p-garbage' },
      stubStatus: 1,
      stubStdout: 'TypeError: something exploded\n    at file.mjs:1:1\n',
      stubStderr: 'a stack trace, not a report',
    })
    assert.equal(res.status, 0)
    assert.ok(res.json)
    const j = /** @type {any} */ (res.json)
    assert.equal(j.decision, undefined)
    assert.match(String(j.systemMessage), /UNVERIFIED/)
    assert.doesNotMatch(String(j.systemMessage), /red/i, 'must not even mention "red", claimed or denied')
    assert.match(res.stderr, /did not produce a readable report/)
  })
})

// ---------------------------------------------------------------------------------------
// 7. green WITH a SKIPPED row
// ---------------------------------------------------------------------------------------

test('7. green with a SKIPPED row: exit 0, systemMessage names the skipped row(s), not "all green"', () => {
  withRoot((root) => {
    const res = runGate({
      root,
      input: { prompt_id: 'p-skip' },
      stubStatus: 0,
      stubStdout: report([
        { id: 'lint', status: 'PASSED' },
        { id: 'audit', status: 'SKIPPED', reason: 'npm-registry: unreachable' },
      ]),
    })
    assert.equal(res.status, 0)
    assert.ok(res.json, 'a green-with-skip run must still say something')
    const j = /** @type {any} */ (res.json)
    assert.equal(j.decision, undefined)
    assert.match(String(j.systemMessage), /fast tier is green, BUT/)
    assert.match(String(j.systemMessage), /\baudit\b/)
    assert.match(String(j.systemMessage), /not "all green"/)
  })
})

// ---------------------------------------------------------------------------------------
// Bonus: the stdin-timeout sentinel (distinguishes SLOW stdin from EMPTY stdin)
// ---------------------------------------------------------------------------------------

test('stdin that never closes within 5s is NOT treated as empty input — takes ~5s', async () => {
  const root = fixtureRoot()
  try {
    await new Promise((resolve, reject) => {
      // Async `spawn`, not `spawnSync`: spawnSync's 'pipe' stdio with no `input` option
      // closes the child's stdin immediately (there is no way to leave it open
      // synchronously), which would test the EMPTY-input path, not the SLOW one. `spawn`
      // gives a real, long-lived stdin stream that this test deliberately never ends.
      const child = spawn(process.execPath, [GATE], {
        cwd: root,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, VERIFY_HOOK_WARN: '' },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => {
        stdout += d
      })
      child.stderr.on('data', (d) => {
        stderr += d
      })
      const safety = setTimeout(() => {
        child.kill()
        reject(new Error('the gate did not exit within 8s — the 5s stdin sentinel did not fire'))
      }, 8000)
      child.on('error', (err) => {
        clearTimeout(safety)
        reject(err)
      })
      child.on('exit', (code) => {
        clearTimeout(safety)
        try {
          assert.equal(code, 0)
          assert.match(stderr, /stdin not fully read within 5s/)
          const lines = stdout.split('\n').filter((l) => l.length > 0)
          assert.equal(lines.length, 1, `stdout must carry exactly one JSON line, got:\n${stdout}`)
          const j = JSON.parse(lines[0])
          assert.match(j.systemMessage, /UNVERIFIED/)
          assert.match(j.systemMessage, /not fully read within 5s/)
          resolve(undefined)
        } catch (err) {
          reject(err)
        }
      })
      // Never call child.stdin.end() — that is the entire point of this test.
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------
// Bonus: safeId() neutralizes a path-traversal prompt_id
// ---------------------------------------------------------------------------------------

test('safeId neutralizes a path-traversal prompt_id — the counter file stays confined to gate-counter/', () => {
  withRoot((root) => {
    const res = runGate({
      root,
      input: { prompt_id: '../../../etc/passwd' },
      stubStatus: 1,
      stubStdout: report([{ id: 'lint', status: 'FAILED', reason: 'x' }]),
    })
    // `.` and `/` are stripped, not rejected outright, so the stripped id ("etcpasswd")
    // is still usable and the block still happens.
    assert.equal(res.status, 2)
    const counterDir = path.join(root, '.verify', 'gate-counter')
    const files = readdirSync(counterDir)
    assert.deepEqual(files, ['etcpasswd.count'])
  })
})

test('safeId rejects a prompt_id over 64 characters after stripping — treated as no-id', () => {
  withRoot((root) => {
    const res = runGate({
      root,
      input: { prompt_id: 'x'.repeat(65) },
      stubStatus: 1,
      stubStdout: report([{ id: 'lint', status: 'FAILED', reason: 'x' }]),
    })
    assert.equal(res.status, 0)
    assert.match(res.stderr, /no prompt_id\/session_id/)
  })
})

// ---------------------------------------------------------------------------------------
// Bonus: capped() is a BYTE cap
// ---------------------------------------------------------------------------------------

test('capped() keeps the stdout JSON small even when a single check reason is huge', () => {
  withRoot((root) => {
    const hugeReason = 'x'.repeat(200_000) // one 200KB field, well past the 65KB reference incident
    // Written to a FILE, not passed via a STUB_STDOUT environment variable: a 200KB env
    // var blows past the OS argv+env size limit (E2BIG) on the spawnSync call that starts
    // the gate process itself — a limit of this test harness, not of stop-gate.mjs, which
    // never routes run.mjs's report through an environment variable.
    const stdoutFile = path.join(root, 'stub-stdout.json')
    writeFileSync(stdoutFile, report([{ id: 'lint', status: 'FAILED', reason: hugeReason }]))
    const res = runGate({
      root,
      input: { prompt_id: 'p-huge' },
      stubStatus: 1,
      stubStdoutFile: stdoutFile,
    })
    assert.equal(res.status, 2)
    assert.ok(res.json)
    const j = /** @type {any} */ (res.json)
    // Both stdout copies of `reason` are capped: this is the exact "one failing check,
    // repeated across fields" growth path the byte cap exists to close.
    assert.ok(
      Buffer.byteLength(String(j.reason), 'utf8') < 10_000,
      `top-level reason should be capped, got ${Buffer.byteLength(String(j.reason), 'utf8')} bytes`,
    )
    assert.ok(
      Buffer.byteLength(String(j.hookSpecificOutput?.reason), 'utf8') < 10_000,
      'hookSpecificOutput.reason should be capped too',
    )
    assert.match(String(j.reason), /truncated/)
    // stderr is deliberately left FULL — it is the authoritative reason channel and
    // carries the real failure table for a human to read, not a JSON payload to keep small.
    assert.ok(Buffer.byteLength(res.stderr, 'utf8') > 150_000, 'stderr must stay uncapped')
  })
})

// ---------------------------------------------------------------------------------------
// Bonus: malformed stdin JSON is treated the same as no input, not a crash
// ---------------------------------------------------------------------------------------

test('malformed JSON on stdin resolves to {} rather than throwing', () => {
  withRoot((root) => {
    const res = runGate({
      root,
      stdin: '{not valid json',
      stubStatus: 0,
      stubStdout: report([{ id: 'lint', status: 'PASSED' }]),
    })
    assert.equal(res.status, 0)
    assert.equal(res.json, null)
  })
})
