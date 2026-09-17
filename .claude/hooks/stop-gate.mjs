#!/usr/bin/env node
/**
 * The gate. Runs on `Stop` — the only blocking layer of the three.
 *
 * Field names verified 2026-08-23 against code.claude.com/docs/en/hooks, reading the
 * Stop section rather than the generic table:
 *
 *  - The Stop section documents the decision at `hookSpecificOutput.decision: "block"`.
 *    No `reason` field is documented there.
 *  - The exit-code table says exit 2 "Blocks the action regardless of JSON" and "stderr
 *    becomes the blocking reason", and that universal fields like `systemMessage` are
 *    still read on exit 2.
 *
 * So exit 2 with the reason on stderr is the load-bearing mechanism, and the JSON carries
 * both the documented shape AND the older top-level `decision`/`reason` pair. Emitting one
 * shape and hoping is how a gate runs on every turn, writes its counter files, and blocks
 * nothing — invisible for hours.
 *
 * Policy:
 *  - fails CLOSED on check failures;
 *  - fails OPEN on its own errors, and loudly — never a bare `|| exit 0`;
 *  - caps consecutive blocks at 2 per `prompt_id`, then lets the turn end while telling
 *    the agent to state the red result explicitly.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const COUNTER_DIR = path.join(ROOT, '.verify', 'gate-counter')
const MAX_BLOCKS = 2

/** @param {unknown} e @returns {string} */
const msg = (e) => (e instanceof Error ? e.message : String(e))

/**
 * `fs.writeSync` on the raw fd, never `process.stdout`/`process.stderr.write`. On POSIX,
 * Node's own stdio docs say a PIPE destination — exactly what this hook writes to when
 * Claude Code spawns it — is asynchronous, while every `process.exit()` call a few lines
 * below runs synchronously and immediately. Pairing an async write with an immediate exit
 * can truncate the write before the pipe drains — precisely the hazard run.mjs's own
 * header comment names ("process.exit can truncate a large asynchronous pipe write"), and
 * precisely why a huge FAILED-check `reason` must not just be capped in the JSON (see
 * `capped()`) but also written in a way that cannot be cut off by the exit that follows it
 * a statement later.
 *
 * `writeSync` ALONE is not enough: the same async-pipe setup that makes `.write()` racy
 * also puts the fd in non-blocking mode, so a single `writeSync` call on a large payload
 * can do a PARTIAL write and return the short byte count with NO exception — proven
 * empirically while writing this file's own tests, where a 200KB failure table on a piped
 * stderr silently arrived truncated to well under half its length. So this loops on the
 * BYTE offset (never the string) until every byte is written, retrying immediately on
 * EAGAIN (the non-blocking fd's "try again" signal, expected to clear as fast as the
 * reading side drains) and giving up only on a real error (EPIPE: the reader is gone).
 *
 * @param {1 | 2} fd
 * @param {string} text
 * @returns {void}
 */
function writeSyncFd(fd, text) {
  const buf = Buffer.from(text, 'utf8')
  let offset = 0
  while (offset < buf.length) {
    try {
      offset += writeSync(fd, buf, offset, buf.length - offset)
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EAGAIN') continue
      break // EPIPE or similar: the reader is gone, and there is nothing left to write to
    }
  }
}

/** @param {string} text @returns {void} */
const writeErr = (text) => writeSyncFd(2, text)

let emitted = false

/** @param {Record<string, unknown>} obj @returns {void} */
function emit(obj) {
  // Exactly ONE object may reach stdout: a second would corrupt the protocol and silently
  // lose the decision (reachable when a write throws EPIPE after the first emit).
  if (emitted) return
  // node.sh cannot reach Claude with a warning of its own — stderr on a zero exit goes to
  // the debug log only — so it hands the text over in the environment and we carry it.
  const warn = process.env.VERIFY_HOOK_WARN
  const withWarn = warn
    ? { ...obj, systemMessage: `${warn}\n${obj.systemMessage ?? ''}`.trim() }
    : obj
  const text = JSON.stringify(withWarn)
  JSON.parse(text)
  emitted = true
  writeSyncFd(1, `${text}\n`)
}

/**
 * A `prompt_id` arrives as untrusted JSON. Used unsanitised as a path component, a value
 * containing `..` would truncate an arbitrary file.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
function safeId(raw) {
  if (typeof raw !== 'string') return null
  const clean = raw.replace(/[^A-Za-z0-9_-]/g, '')
  if (!clean || clean.length > 64) return null
  return clean
}

/** @returns {Promise<Record<string, unknown>>} */
function readInput() {
  return new Promise((resolve) => {
    let raw = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => {
      raw += c
    })
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve({})
      }
    })
    // A hook with no stdin must not hang the turn until the harness timeout. But a SLOW
    // stdin must not be mistaken for an EMPTY one: that silently drops prompt_id and
    // turns a block into a non-block. The sentinel says which case happened.
    setTimeout(() => resolve({ __verifyStdinTimedOut: true }), 5000).unref()
  })
}

/**
 * @param {string} id
 * @returns {{ count: number, bump: () => boolean, reset: () => void }}
 */
function counter(id) {
  const file = path.join(COUNTER_DIR, `${id}.count`)
  let count = 0
  try {
    count = Number.parseInt(readFileSync(file, 'utf8').trim(), 10)
    if (!Number.isFinite(count) || count < 0) count = 0
  } catch {
    count = 0
  }
  return {
    count,
    // Returns false when the write failed. Silence there disables the cap entirely and
    // deadlocks the agent against the gate, so the caller says so out loud.
    bump: () => {
      try {
        mkdirSync(COUNTER_DIR, { recursive: true })
        // One file per prompt_id would otherwise accumulate forever.
        try {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000
          for (const f of readdirSync(COUNTER_DIR)) {
            const p = path.join(COUNTER_DIR, f)
            if (statSync(p).mtimeMs < cutoff) rmSync(p, { force: true })
          }
        } catch {
          /* pruning is housekeeping; never let it affect the decision */
        }
        writeFileSync(file, String(count + 1))
        return true
      } catch {
        return false
      }
    },
    reset: () => {
      try {
        mkdirSync(COUNTER_DIR, { recursive: true })
        writeFileSync(file, '0')
      } catch {
        /* a failed reset only costs a stricter cap next turn */
      }
    },
  }
}

/**
 * SKIPPED rows from a green run. Reads the fresh report from disk when stdout was empty,
 * which is what `--reuse-if-fresh` does on a cache hit.
 *
 * @param {string | undefined} stdout
 * @returns {string[]}
 */
function skippedRows(stdout) {
  /** @type {any} */
  let report
  try {
    report = JSON.parse(stdout || '')
  } catch {
    try {
      report = JSON.parse(readFileSync(path.join(ROOT, '.verify', 'last-run.json'), 'utf8'))
    } catch {
      return []
    }
  }
  if (!Array.isArray(report?.checks)) return []
  return report.checks
    .filter((/** @type {any} */ r) => r.status === 'SKIPPED')
    .map((/** @type {any} */ r) => String(r.id))
}

/**
 * A BYTE cap, not just a line cap. One failing check can emit a single 65KB JSON line, and
 * `detail` is repeated in several fields — a 361KB payload was measured in review. Cutting
 * by JS string length/`.slice()` alone caps UTF-16 code units, which is not the same
 * number as bytes once the text has any multi-byte character in it, so the truncation
 * point is computed in actual UTF-8 bytes via `Buffer` — a boundary that lands inside a
 * multi-byte character renders as one or two U+FFFD replacement characters, which is an
 * acceptable cost for an accurate cap.
 *
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function capped(text, max = 4000) {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= max) return text
  return `…(truncated)\n${buf.subarray(buf.length - max).toString('utf8')}`
}

/** @param {Record<string, unknown>} report @returns {string} */
function failureTable(report) {
  const rows = Array.isArray(report.checks) ? report.checks : []
  const bad = rows.filter((/** @type {any} */ r) => r.status !== 'PASSED')
  const lines = bad.map(
    (/** @type {any} */ r) =>
      `  ${String(r.status).padEnd(11)} ${r.id}${r.reason ? ` — ${r.reason}` : ''}`,
  )
  const skipped = rows.filter((/** @type {any} */ r) => r.status === 'SKIPPED').length
  return [
    `Fast tier is RED — this turn must not be closed with a claim of success.`,
    ``,
    ...lines,
    ``,
    `Full output: npm run verify`,
    `Report: .verify/last-run.json (sourceHash ${String(report.sourceHash ?? '?').slice(0, 12)})`,
    skipped
      ? `\nWARNING: ${skipped} check(s) were skipped — that is not "all green".`
      : ``,
    ``,
    `Fix the cause, not the check — widening a baseline, relaxing a rule or lowering a`,
    `floor is not turning green (see CLAUDE.md, rule 3).`,
  ]
    .filter((l) => l !== undefined)
    .join('\n')
}

async function main() {
  const input = await readInput()

  // Could not read the harness's input at all → could not evaluate. Taking the no-id
  // branch here would report "no prompt_id" and quietly let a red turn end.
  if (input.__verifyStdinTimedOut) {
    writeErr('verify-gate: stdin not fully read within 5s — turn NOT evaluated\n')
    emit({
      systemMessage:
        'verify-gate: COULD NOT EVALUATE this turn — the harness input JSON was not fully ' +
        'read within 5s. This is not a green result: treat the turn as UNVERIFIED and say ' +
        'so explicitly.',
    })
    process.exit(0)
  }
  // NEVER fall back to session_id. It is stable across turns while reset() only runs on a
  // green, so on a persistently red tree the count saturates in turn 1 and every later
  // turn sails through — the gate runs, writes its counter, and blocks nothing. No
  // prompt_id means no cap is possible, which the no-id branch below handles honestly.
  const id = safeId(input.prompt_id)

  // 150s, and this is the ONE budget here that is deliberately not cut close. The other
  // two hooks wrap a single measured command; this one wraps the whole fast tier, whose
  // cost is dominated by `selfcheck` — 36s of `node --test` that nothing caches and that
  // grows with every test this layer adds. A warm fast run is ~41s and a cold one is
  // around 77s BY ARITHMETIC over two measurements rather than by measurement (CLAUDE.md
  // says why a true cold reading is not available in a worktree), so the margin has to
  // absorb growth and an unmeasured number, not just variance. 240s was the previous
  // value and had no reasoning attached; 150s is ~2x the cold estimate.
  //
  // Most turns never approach it: --reuse-if-fresh replays an already-green report for
  // the same source hash in about 0.06s.
  const run = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'verify', 'run.mjs'), '--tier', 'fast', '--reuse-if-fresh', '--json'],
    { cwd: ROOT, encoding: 'utf8', timeout: 150_000, env: process.env },
  )

  // --- the gate's own failure: open, and loud -------------------------------------
  if (run.error || run.status === null) {
    const why = run.error ? msg(run.error) : 'the verification process did not finish (possibly a timeout)'
    writeErr(`verify-gate: could not evaluate this turn: ${why}\n`)
    emit({
      systemMessage:
        `verify-gate: COULD NOT EVALUATE this turn (${why}). ` +
        `Treat the turn as UNVERIFIED and say so explicitly — this is not a green result.`,
      additionalContext:
        `The verification gate did not run: ${why}. Do not claim success. Run "npm run ` +
        `verify" manually and report the real result.`,
    })
    process.exit(0)
  }

  // --reuse-if-fresh exits 0 with no output when a green verdict already covers this
  // exact sourceHash.
  //
  // But exit 0 is NOT the same as "everything was verified": SKIPPED does not block
  // without --no-skip, so a green can legitimately contain rows that checked nothing. The
  // runner says so in its own footer; the gate must not swallow that. Today no fast-tier
  // check declares a precondition, so this cannot fire — it is here so that adding one
  // later cannot turn a skip into a silent pass.
  if (run.status === 0) {
    if (id) counter(id).reset()
    const skipped = skippedRows(run.stdout)
    if (skipped.length) {
      emit({
        systemMessage:
          `verify-gate: fast tier is green, BUT ${skipped.length} check(s) were skipped — ` +
          `${skipped.join(', ')}. This is not "all green": nothing was verified about ` +
          `these rows, and that must be said out loud in the reply.`,
      })
    }
    process.exit(0)
  }

  /** @type {Record<string, unknown>} */
  let report = {}
  try {
    report = JSON.parse(run.stdout || '{}')
  } catch {
    report = {}
  }

  // No parseable verdict means the runner never reached the end — a MODULE_NOT_FOUND, a
  // bad flag, a hashing failure. That is the GATE's problem, not the code's, and blocking
  // on it would assert something about the tree that was never tested. It is the same sin
  // as reporting "lint FAILED" for a missing linter, one level up. Fail open, loudly.
  if (!Array.isArray(report.checks)) {
    const tail = capped((run.stderr || run.stdout || '').trim().split('\n').slice(-12).join('\n'))
    writeErr(`verify-gate: checks did not produce a readable report (exit code ${run.status})\n${tail}\n`)
    emit({
      // Deliberately free of the word "red" in any form: this is not a verdict on the
      // tree at all, and a systemMessage that even mentions "red" while denying it is a
      // needless risk of being misread as the opposite of what it says.
      systemMessage:
        `verify-gate: COULD NOT EVALUATE this turn — the runner exited with code ` +
        `${run.status} without a report. This is not a verdict on the tree at all: the ` +
        `turn is UNVERIFIED.`,
      additionalContext:
        `The gate got no report from scripts/verify/run.mjs (exit code ${run.status}). Do ` +
        `not claim success: the checks never ran to completion, so nothing is known about ` +
        `whether they pass. Run "npm run verify" manually.\n\n${tail}`,
    })
    process.exit(0)
  }

  const detail = failureTable(report)

  // --- loop guard -----------------------------------------------------------------
  if (!id) {
    // No usable id means no cap is possible. Blocking without a cap can deadlock the
    // agent against the gate, so this reports and lets the turn end.
    writeErr('verify-gate: no prompt_id/session_id in the input — a counter is impossible\n')
    emit({
      systemMessage:
        'verify-gate: checks are RED, but with no prompt_id a block counter is impossible, ' +
        'so this turn is not blocked. The red result must be stated explicitly:\n\n' + capped(detail),
      additionalContext: capped(detail),
    })
    process.exit(0)
  }

  const c = counter(id)
  if (c.count >= MAX_BLOCKS) {
    // The instruction goes in systemMessage, which the docs describe as "shown to Claude,
    // not the user". additionalContext is documented only for PostToolUse /
    // UserPromptSubmit / UserPromptExpansion — NOT for Stop — so the whole payoff of the
    // cap-release path would have had no documented delivery channel. It is kept as a
    // harmless second copy for versions that do read it.
    const instruction =
      `verify-gate: already ${c.count} block(s) on this prompt — the limit of ${MAX_BLOCKS} ` +
      `has been reached, the gate will no longer block, and this turn ends UNVERIFIED.\n\n` +
      `${capped(detail)}\n\n` +
      `You MUST start your reply with a direct statement: the checks are red, exactly ` +
      `which ones, and what remains to be done. Do not describe the work as finished.`
    emit({ systemMessage: instruction, additionalContext: instruction })
    process.exit(0)
  }

  // If the counter cannot be written, the cap can never be reached — blocking anyway is an
  // unbounded block, i.e. a deadlock between the gate and the agent. Being loud about it
  // does not stop the deadlock, so this reports instead of blocking.
  if (!c.bump()) {
    writeErr('verify-gate: could not write the block counter — not blocking\n')
    emit({
      systemMessage:
        'verify-gate: checks are RED, but the block counter cannot be written (permissions ' +
        'on .verify/?), so the 2-attempt cap would not hold and this turn could be blocked ' +
        'forever. So this is NOT blocking. The red result must be stated explicitly:\n\n' +
        capped(detail),
    })
    process.exit(0)
  }

  // --- block: every documented shape, plus exit 2 ----------------------------------
  // NO `continue: false` here, and no `stopReason`. The docs are explicit that
  // `continue: false` means "Claude stops processing entirely after the hook runs" and
  // that it "takes precedence over any event-specific decision fields" — which is the
  // exact OPPOSITE of a Stop block (block = do not stop, keep going and fix it). Emitting
  // both would have inverted the gate's primary path from "send the agent back" into
  // "halt the session", and the failure table would never have been acted on.
  //
  // `reason` is capped in BOTH shapes below — the two fields the reference this was
  // ported from left uncapped, which is exactly the "detail repeated across fields"
  // growth path the byte-cap exists to close: a single 65KB FAILED-row detail would
  // otherwise appear twice in this one stdout JSON line alone. stderr is deliberately
  // left FULL a few lines down: it is the authoritative reason per the exit-code table,
  // carries no "must stay one JSON line" constraint, and a human reading it should see
  // the complete table, not a truncated one.
  emit({
    // documented in the Stop section
    hookSpecificOutput: { hookEventName: 'Stop', decision: 'block', reason: capped(detail) },
    // older top-level pair, still honoured by some versions
    decision: 'block',
    reason: capped(detail),
    // systemMessage is documented as "shown to Claude, not the user" — the right channel.
    systemMessage: 'verify-gate: fast tier is red — this turn is blocked.',
  })
  // Authoritative per the exit-code table: blocks regardless of JSON, stderr is the reason.
  writeErr(`${detail}\n`)
  process.exit(2)
}

main().catch((err) => {
  writeErr(`verify-gate: internal error: ${msg(err)}\n`)
  emit({
    systemMessage: `verify-gate: internal error (${msg(err)}) — this turn was NOT verified. Do not claim success.`,
  })
  process.exit(0)
})
