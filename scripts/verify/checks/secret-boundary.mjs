#!/usr/bin/env node
/**
 * The boundary that keeps credentials out of this repository.
 *
 * This is a fresh check, not a port. The reference implementation (yagoda-crm) had a
 * `pii` check guarding a PUBLIC repo against real supplier names leaking into gitignored
 * `docs/` and `input/` folders — that subject does not exist here. The boundary that DOES
 * exist here is the secret one: `JWT_SECRET` and `DB_PASSWORD` live in the untracked root
 * `.env`; CI supplies throwaway values inline in the workflow. Root `.gitignore` carries
 * exactly:
 *
 *   .env
 *   .env.*
 *   !.env.example
 *
 * Four rules, in order:
 *
 *  1. `.env` and `.env.*` are not tracked — `git ls-files -- .env .env.*` must return
 *     nothing but `.env.example`.
 *  2. That gitignore boundary is FINGERPRINTED in baselines/secret-boundary.json with a
 *     dated reason, so relaxing those three lines is a visible diff in a reviewed file,
 *     not a silent widening of what git will track.
 *  3. No tracked file carries a secret shape: a PEM private-key block, a JWT, or a
 *     ≥32-character value assigned to a name matching /secret|password|token|api[_-]?key/i
 *     whose WHOLE-VALUE Shannon entropy exceeds 3.5 bits/char. package-lock.json
 *     (integrity hashes) and this check's own baseline file are skipped.
 *  4. `.env.example` is placeholder-only: every value is empty, matches a named
 *     placeholder shape, or is short/low-entropy on its own merits — regardless of what
 *     its key is named. `.env.example` is not exempt from rule 3 either; this is an
 *     ADDITIONAL, stricter layer on top of it.
 *
 * A SECRET IS NEVER BASELINED. The baseline holds only the gitignore fingerprint — if
 * rule 3 or rule 4 finds something, that is a finding to fix, never a value to record.
 *
 * Entropy is measured over the WHOLE value, not a contiguous run within it — measured
 * before choosing this: a real base64url token scores 5.25 bits/char and a real
 * hyphen-separated credential scores 3.89, but restricting the measurement to the longest
 * `[A-Za-z0-9]` run (an earlier version of this check did exactly that, to keep this
 * repo's own `.env.example` placeholder green) drops the hyphenated case to 2.00 —
 * comfortably under the 3.5 threshold, and hyphen/underscore-separated secrets are one of
 * the most common real shapes. That earlier version optimised the measurement to fit the
 * tree instead of fixing the tree to fit the measurement — the exact failure mode rule 3
 * of this check's own contract calls out. The right fix, applied here instead: name the
 * repository's actual placeholder shapes in PLACEHOLDER_RE (shared by rules 3 and 4) so
 * they never reach the entropy test at all, and keep the measurement honest for
 * everything else.
 *
 * A bare, unquoted value is only a candidate when it is the WHOLE line — see
 * BARE_ASSIGNMENT_RE below. Restoring whole-value entropy across every tracked file (not
 * just .env.example) surfaced a second, unrelated false positive this measurement change
 * introduced: `const password = process.env.BOOTSTRAP_OWNER_PASSWORD;` — a property access,
 * not a literal — scored high enough to trip rule 3 on its own RHS. A quoted string literal
 * is the only thing JS/TS syntax allows a real hardcoded secret to be, so it stays a
 * candidate anywhere in a line; an unquoted RHS embedded in a statement never is.
 *
 * Entropy heuristics still have real limits: a placeholder shape not yet named in
 * PLACEHOLDER_RE can false-positive, and a short or low-entropy real secret can stay
 * under the threshold entirely (false negative) — nothing under 32 characters is ever
 * inspected. This check also sees only tracked files at the CURRENT commit — a secret
 * committed and later removed is invisible to it, and it cannot distinguish a real
 * credential from a convincing fake. See the registry's `blindSpot` for the full list.
 *
 * There is no per-file-type or per-directory exemption of any kind — not for `.md`, not
 * for test files, not for any path. The one KNOWN_SAFE_VALUES entry below is not one
 * either: it is an exact (file, value) pin, not a shape, and it exists solely because this
 * task may not edit backend/src or frontend/src — see its own comment for why.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

import { errMessage } from '../hash.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const GITIGNORE_PATH = path.join(ROOT, '.gitignore')
const ENV_EXAMPLE_PATH = path.join(ROOT, '.env.example')
const BASELINE_REL = 'scripts/verify/baselines/secret-boundary.json'
const BASELINE_PATH = path.join(ROOT, BASELINE_REL)

// The exact three lines this check's whole job is defending. Order matches the file.
const GITIGNORE_BOUNDARY_LINES = ['.env', '.env.*', '!.env.example']

// Files rule 3 does not scan: package-lock.json is pure integrity hashes (high entropy by
// construction, on every line, on purpose), and the baseline file records a hash of
// gitignore lines that itself looks like nothing in particular but is exempted on principle
// — a check's own baseline is not "a tracked file" in the sense rule 3 means.
const RULE3_SKIP = new Set(['package-lock.json', BASELINE_REL])

// Exact, reviewed exceptions — NOT a shape, NOT a file-type or path carve-out, and never a
// place to record a real secret. Each entry names one exact tracked-file path AND the one
// exact value already confirmed to be a deliberately fake fixture in it. Both must match
// for the exception to apply, so it excludes nothing else — not the file, not nearby
// values, not this same string appearing anywhere else.
//
// This exists only because this task is constrained to never edit backend/src or
// frontend/src, so "fix the tree" (the right answer for docs/superpowers and
// .env.example, applied elsewhere in this file and its own history) is not available for
// this one value. frontend/src/shared/api/persister.test.ts:42 is a regression guard for
// a real security fix (the raw bearer token must never sit in the persisted cache key) —
// its fixture is intentionally JWT-shaped so the assertion is meaningful, and it names
// itself as fake in its own text ("super-secret-session-token"). If this file is ever
// touched by a change with permission to edit frontend/src, the fixture should be
// reshaped to not need this entry, and the entry deleted.
const KNOWN_SAFE_VALUES = new Map([
  [
    'frontend/src/shared/api/persister.test.ts',
    new Set(['eyJhbGciOiJIUzI1NiJ9.super-secret-session-token.sig']),
  ],
])

const PEM_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/
const SECRET_NAME_RE = /secret|password|token|api[_-]?key/i

// Every placeholder shape this repository's own config files actually use, named
// explicitly rather than inferred from a shape test. `change-me` (hyphenated) covers
// .env.example's JWT_SECRET line (`change-me-to-a-32-character-minimum-secret`) —
// `changeme` alone does not match it, which is exactly why it used to false-positive.
const PLACEHOLDER_RE = /^(changeme|change-me|example|your-|<.*>|\.\.\.)/i

// A quoted string literal, anywhere in the line: `NAME = "value"`, `NAME: 'value'`. A real
// secret hardcoded into source is always a quoted literal — JS/TS has no other syntax for
// one — so this is unrestricted by position or by what else the statement contains.
const QUOTED_ASSIGNMENT_RE = /([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]\s*(?:'([^']*)'|"([^"]*)")/g

// A bare, unquoted value — but ONLY when it is the entire line (trimmed), optionally
// followed by a `#` comment: `NAME=value` (.env), `NAME: value` (YAML). This is what
// `.env`, `.env.example` and CI workflow env blocks actually look like, and it is also
// what deliberately excludes a code statement like `const password =
// process.env.BOOTSTRAP_OWNER_PASSWORD;` — that RHS is unquoted too, but it is a property
// access, not a literal, and the line also carries `const `/`;` the value alone cannot
// swallow, so the whole-line anchor fails to match and it is never a candidate. An
// unquoted bare token is not even valid JS/TS syntax for a string literal in the first
// place, so restricting it to whole-line-only loses no real secret a source file could
// actually contain.
const BARE_ASSIGNMENT_RE = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]\s*([^\s'";,)]+?)\s*(?:#.*)?$/

/**
 * Shannon entropy in bits per character.
 *
 * @param {string} s
 * @returns {number}
 */
function shannonEntropy(s) {
  if (!s.length) return 0
  const freq = new Map()
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  let bits = 0
  for (const count of freq.values()) {
    const p = count / s.length
    bits -= p * Math.log2(p)
  }
  return bits
}

/**
 * The one shape test rules 3 and 4 both use: at least 32 characters, whole-value Shannon
 * entropy over 3.5 bits/char, and not a recognised placeholder shape. Whole-value, not a
 * contiguous run within it — see the file header for why a run-based measurement was
 * tried and rejected. A placeholder is excluded BEFORE the entropy test runs, by name
 * (`PLACEHOLDER_RE`), not by weakening what the test measures.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isSecretShapedValue(value) {
  if (!value) return false
  if (PLACEHOLDER_RE.test(value)) return false
  return value.length >= 32 && shannonEntropy(value) > 3.5
}

/**
 * @param {string} line
 * @returns {{ name: string, value: string }[]}
 */
function extractAssignments(line) {
  /** @type {{ name: string, value: string }[]} */
  const out = []
  QUOTED_ASSIGNMENT_RE.lastIndex = 0
  let m
  while ((m = QUOTED_ASSIGNMENT_RE.exec(line))) {
    const value = m[2] ?? m[3]
    if (value) out.push({ name: m[1], value })
  }
  const bare = BARE_ASSIGNMENT_RE.exec(line.trim())
  if (bare && bare[2]) out.push({ name: bare[1], value: bare[2] })
  return out
}

/**
 * Rule 1: `.env` and every `.env.*` variant must be untracked. The only permitted match is
 * the one line `.gitignore` explicitly carves back out.
 *
 * @returns {string[]} findings, empty when clean
 */
function checkEnvNotTracked() {
  /** @type {string} */
  let out
  try {
    out = execFileSync('git', ['ls-files', '--', '.env', '.env.*'], { cwd: ROOT, encoding: 'utf8' })
  } catch (err) {
    return [`could not list tracked .env files: ${errMessage(err)}`]
  }
  const tracked = out.split('\n').filter(Boolean)
  const unexpected = tracked.filter((f) => f !== '.env.example')
  if (unexpected.length === 0) return []
  return [
    `${unexpected.join(', ')}: tracked by git, but only .env.example may be — .env and its ` +
      'variants must stay untracked (root .gitignore). Untrack with `git rm --cached <file>` ' +
      'and rotate any credential it held.',
  ]
}

/**
 * Rule 2: the gitignore boundary is fingerprinted. Reads the CURRENT `.gitignore`,
 * confirms the three boundary lines are present verbatim, hashes them, and compares
 * against the recorded baseline. Any drift — a missing line, a reordered or edited one —
 * surfaces here as a named fingerprint mismatch, never silently.
 *
 * @returns {string[]} findings, empty when clean
 */
function checkGitignoreFingerprint() {
  /** @type {string} */
  let content
  try {
    content = readFileSync(GITIGNORE_PATH, 'utf8')
  } catch (err) {
    return [`root .gitignore is unreadable: ${errMessage(err)} — the secret boundary it should encode cannot be verified.`]
  }
  const lines = new Set(content.split('\n').map((l) => l.replace(/\r$/, '')))
  const missing = GITIGNORE_BOUNDARY_LINES.filter((l) => !lines.has(l))
  if (missing.length > 0) {
    return [
      `.gitignore secret-boundary fingerprint mismatch: line(s) ${missing.map((l) => JSON.stringify(l)).join(', ')} ` +
        `no longer appear verbatim in .gitignore. ${BASELINE_REL} records a hash of the three lines ` +
        `${GITIGNORE_BOUNDARY_LINES.map((l) => JSON.stringify(l)).join(', ')} — if this change is deliberate, ` +
        'update the baseline (with a dated reason) in its own reviewed commit; if not, restore the line(s).',
    ]
  }

  const computed = createHash('sha256').update(GITIGNORE_BOUNDARY_LINES.join('\n'), 'utf8').digest('hex')

  /** @type {any} */
  let baseline
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  } catch (err) {
    return [`${BASELINE_REL} is missing or is not valid JSON: ${errMessage(err)}`]
  }
  const expected = baseline?.gitignoreSecretBoundary?.sha256
  if (typeof expected !== 'string' || expected.length === 0) {
    return [`${BASELINE_REL} has no gitignoreSecretBoundary.sha256 to compare against.`]
  }
  if (expected !== computed) {
    return [
      `.gitignore secret-boundary fingerprint mismatch: computed ${computed} over the current ` +
        `.env / .env.* / !.env.example lines, but ${BASELINE_REL} records ${expected}. A change to ` +
        'those lines must land as a deliberate, reviewed baseline update, not silently.',
    ]
  }
  return []
}

/**
 * Every tracked file, repo-root-relative, posix-separated, as `git ls-files` prints it.
 *
 * @returns {string[]}
 */
function listTrackedFiles() {
  const NUL = String.fromCharCode(0)
  let raw
  try {
    raw = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 })
  } catch (err) {
    throw new Error(`secret-boundary: git could not enumerate tracked files: ${errMessage(err)}`)
  }
  return raw.toString('utf8').split(NUL).filter(Boolean)
}

/**
 * @param {string} absPath
 * @returns {string | null} the file's text, or null when it is binary or unreadable
 */
function readTextOrNull(absPath) {
  /** @type {Buffer} */
  let buf
  try {
    buf = readFileSync(absPath)
  } catch {
    return null
  }
  if (buf.includes(0)) return null // a NUL byte means binary — nothing here reads as an assignment or a PEM block
  return buf.toString('utf8')
}

/**
 * Rule 3: scan every tracked file (less the two skips) for a PEM private-key block, a
 * JWT-shaped string, or a high-entropy value assigned to a secret-sounding name. Applies
 * uniformly to every tracked file, .md included — there is no per-file-type exemption: a
 * file that needs to describe one of these patterns must build it at runtime instead of
 * writing it down (see docs/superpowers/plans/2026-09-10-verify-layer.md and this check's
 * own test file for examples of doing exactly that).
 *
 * @returns {string[]} findings, empty when clean
 */
function scanTrackedFilesForSecretShapes() {
  /** @type {string[]} */
  const findings = []
  for (const rel of listTrackedFiles()) {
    if (RULE3_SKIP.has(rel)) continue
    const text = readTextOrNull(path.join(ROOT, rel))
    if (text === null) continue
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const lineNo = i + 1
      if (PEM_RE.test(line)) {
        findings.push(`${rel}:${lineNo}: contains a PEM private-key block — private keys must never be committed.`)
      }
      if (JWT_RE.test(line)) {
        findings.push(`${rel}:${lineNo}: contains a JWT-shaped string — tokens must never be committed.`)
      }
      for (const { name, value } of extractAssignments(line)) {
        if (!SECRET_NAME_RE.test(name)) continue
        if (!isSecretShapedValue(value)) continue
        if (KNOWN_SAFE_VALUES.get(rel)?.has(value)) continue
        findings.push(
          `${rel}:${lineNo}: ${name} is assigned a ${value.length}-character high-entropy value ` +
            `(${shannonEntropy(value).toFixed(2)} bits/char) — looks like a real secret, not a placeholder.`,
        )
      }
    }
  }
  return findings
}

/**
 * Rule 4: `.env.example` is placeholder-only. Every assigned value, regardless of its
 * key's name, must be empty, match a named placeholder shape, or fail the whole-value
 * high-entropy test on its own merits — a realistic-looking secret must not hide behind
 * an innocuous key name.
 *
 * @returns {string[]} findings, empty when clean
 */
function checkEnvExamplePlaceholderOnly() {
  /** @type {string} */
  let text
  try {
    text = readFileSync(ENV_EXAMPLE_PATH, 'utf8')
  } catch (err) {
    return [`.env.example is missing or unreadable: ${errMessage(err)} — it must exist, committed, as the placeholder template for .env.`]
  }
  /** @type {string[]} */
  const findings = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].trim()
    const lineNo = i + 1
    if (!raw || raw.startsWith('#')) continue
    const eq = raw.indexOf('=')
    if (eq === -1) continue
    const name = raw.slice(0, eq).trim()
    let value = raw.slice(eq + 1).trim()
    value = value.replace(/\s+#.*$/, '').trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    if (!isSecretShapedValue(value)) continue
    findings.push(
      `.env.example:${lineNo}: ${name} holds a ${value.length}-character high-entropy value ` +
        `(${shannonEntropy(value).toFixed(2)} bits/char) — .env.example must hold only placeholders ` +
        '(empty, changeme/change-me/example/your-/<...>/... , or short and low-entropy).',
    )
  }
  return findings
}

function main() {
  /** @type {string[]} */
  const findings = [
    ...checkEnvNotTracked(),
    ...checkGitignoreFingerprint(),
    ...scanTrackedFilesForSecretShapes(),
    ...checkEnvExamplePlaceholderOnly(),
  ]

  if (findings.length > 0) {
    process.stderr.write('secrets: RED\n')
    for (const f of findings) process.stderr.write(`  ${f}\n`)
    process.exit(1)
  }

  process.stdout.write(
    'secrets: boundary intact — .env untracked (only .env.example), gitignore fingerprint ' +
      'matches the baseline, no tracked file carries a PEM/JWT/high-entropy secret shape, ' +
      'and .env.example is placeholder-only\n',
  )
}

main()
