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
 *     ≥32-character high-entropy value assigned to a name matching
 *     /secret|password|token|api[_-]?key/i. package-lock.json (integrity hashes) and this
 *     check's own baseline file are skipped.
 *  4. `.env.example` is placeholder-only: every value is empty, matches a placeholder
 *     shape, or is short/low-entropy on its own merits — regardless of what its key is
 *     named. `.env.example` is not exempt from rule 3 either; this is an ADDITIONAL,
 *     stricter layer on top of it.
 *
 * A SECRET IS NEVER BASELINED. The baseline holds only the gitignore fingerprint — if
 * rule 3 or rule 4 finds something, that is a finding to fix, never a value to record.
 *
 * Entropy heuristics have real limits, on both sides: a dense natural-language phrase can
 * cross the threshold (false positive) and a short or structured secret can stay under it
 * (false negative). This check also sees only tracked files at the CURRENT commit — a
 * secret committed and later removed is invisible to it, and it cannot distinguish a real
 * credential from a convincing fake. See the registry's `blindSpot` for the full list.
 *
 * One more deliberate exemption: inside a `.md` file, a match fully wrapped in a single
 * pair of backticks (an inline code span, e.g. the literal text of a PEM header quoted as
 * an example) is not reported. Without it, this repository's own planning docs — which
 * quote these exact patterns as illustrations of what the check looks for — would trip the
 * scanner forever. The exemption is scoped to `.md` files only: a `.ts`/`.mjs` file's
 * backticks are template literals, not quotation, and must stay in scope. The blind spot is
 * real and named in the registry: a genuine secret pasted inside a markdown inline-code
 * span is invisible here.
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

const PEM_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
const SECRET_NAME_RE = /secret|password|token|api[_-]?key/i

// A placeholder value in .env.example: empty is handled separately before this runs.
const PLACEHOLDER_RE = /^(changeme|example|your-|<.*>|\.\.\.)/i

// `NAME=value`, `NAME: value`, `NAME: "value"`, `NAME = 'value'` — env files, JSON-ish and
// JS/TS object literals all read the same way for this purpose.
const ASSIGNMENT_RE = /([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]\s*(?:'([^']*)'|"([^"]*)"|([^\s'";,)]+))/g

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
 * A real secret is one unbroken run of characters — a hex digest, a base64 blob, an
 * opaque token. A hyphenated English phrase like "change-me-to-a-32-character-secret" is
 * exactly as long, but no single word in it is: this is what tells a generated secret
 * apart from a placeholder sentence built to *look* like it satisfies a length rule.
 * Restricting to plain alnum (no `-`/`_`) is a deliberate, documented blind spot — see
 * this check's registry `blindSpot` entry.
 *
 * @param {string} value
 * @returns {string} the longest contiguous run of [A-Za-z0-9] in `value`
 */
function longestAlnumRun(value) {
  let best = ''
  for (const run of value.match(/[A-Za-z0-9]+/g) ?? []) {
    if (run.length > best.length) best = run
  }
  return best
}

/**
 * Rule 3's shape test, on the value alone: a ≥32-character contiguous alnum run whose
 * Shannon entropy exceeds 3.5 bits/char. Whether that run's NAME also looks secret-shaped
 * is decided by the caller — rule 3 requires it, rule 4 (.env.example) deliberately does
 * not, because .env.example must hold no realistic secret under ANY key name.
 *
 * @param {string} value
 * @returns {{ high: boolean, run: string, entropy: number }}
 */
function highEntropyRun(value) {
  const run = longestAlnumRun(value)
  const entropy = shannonEntropy(run)
  return { high: run.length >= 32 && entropy > 3.5, run, entropy }
}

/**
 * @param {string} line
 * @returns {{ name: string, value: string, start: number, end: number }[]}
 */
function extractAssignments(line) {
  const out = []
  ASSIGNMENT_RE.lastIndex = 0
  let m
  while ((m = ASSIGNMENT_RE.exec(line))) {
    const name = m[1]
    const value = m[2] ?? m[3] ?? m[4]
    if (value) out.push({ name, value, start: m.index, end: m.index + m[0].length })
  }
  return out
}

/**
 * True when `line[start..end)` sits inside a single-line markdown inline-code span —
 * immediately preceded by a backtick and immediately followed by one. Scoped to `.md`
 * files by the caller: elsewhere a backtick is a template-literal delimiter, not quotation.
 *
 * @param {string} line
 * @param {number} start
 * @param {number} end
 * @returns {boolean}
 */
function isMarkdownInlineCodeQuoted(line, start, end) {
  return line[start - 1] === '`' && line[end] === '`'
}

/**
 * Every non-overlapping match of a global `re` against `line`, as matched text plus its
 * span — with markdown inline-code-quoted occurrences already filtered out when `isMarkdown`.
 *
 * @param {RegExp} re a regexp with the `g` flag
 * @param {string} line
 * @param {boolean} isMarkdown
 * @returns {{ text: string, start: number, end: number }[]}
 */
function findRealMatches(re, line, isMarkdown) {
  const out = []
  re.lastIndex = 0
  let m
  while ((m = re.exec(line))) {
    const start = m.index
    const end = start + m[0].length
    if (!(isMarkdown && isMarkdownInlineCodeQuoted(line, start, end))) {
      out.push({ text: m[0], start, end })
    }
    if (m[0].length === 0) re.lastIndex += 1 // defensive: never actually zero-length here
  }
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
 * JWT-shaped string, or a high-entropy value assigned to a secret-sounding name.
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
    const isMarkdown = rel.endsWith('.md')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const lineNo = i + 1
      findRealMatches(PEM_RE, line, isMarkdown).forEach(() => {
        findings.push(`${rel}:${lineNo}: contains a PEM private-key block — private keys must never be committed.`)
      })
      findRealMatches(JWT_RE, line, isMarkdown).forEach(() => {
        findings.push(`${rel}:${lineNo}: contains a JWT-shaped string — tokens must never be committed.`)
      })
      for (const { name, value, start, end } of extractAssignments(line)) {
        if (!SECRET_NAME_RE.test(name)) continue
        if (isMarkdown && isMarkdownInlineCodeQuoted(line, start, end)) continue
        const { high, run, entropy } = highEntropyRun(value)
        if (high) {
          findings.push(
            `${rel}:${lineNo}: ${name} is assigned a high-entropy value (${run.length} contiguous ` +
              `alnum chars, ${entropy.toFixed(2)} bits/char) — looks like a real secret, not a placeholder.`,
          )
        }
      }
    }
  }
  return findings
}

/**
 * Rule 4: `.env.example` is placeholder-only. Every assigned value, regardless of its
 * key's name, must be empty, match the placeholder shape, or fail the high-entropy test on
 * its own merits — a realistic-looking secret must not hide behind an innocuous key name.
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
    if (!value) continue
    if (PLACEHOLDER_RE.test(value)) continue
    const { high, run, entropy } = highEntropyRun(value)
    if (high) {
      findings.push(
        `.env.example:${lineNo}: ${name} holds a ${run.length}-character high-entropy value ` +
          `(${entropy.toFixed(2)} bits/char) — .env.example must hold only placeholders ` +
          '(empty, changeme/example/your-/<...>/... , or short and low-entropy).',
      )
    }
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
