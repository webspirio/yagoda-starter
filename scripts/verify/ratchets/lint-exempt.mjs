#!/usr/bin/env node
/**
 * The lint-exemption ratchet: every place this repo tells eslint to look away.
 *
 * This is a fresh check, not a port. The reference implementation (yagoda-crm, pinned at
 * 468e184, `.oxlintrc.json`'s `overrides` block) lifts a per-file `"off"` override and asks
 * oxlint what it finds with the exemption removed, then holds the answer to an exact count
 * per file. That mechanism is oxlint-specific — this repo runs eslint 9's flat config, whose
 * "exemption" surface is not one `overrides` block but THREE different shapes: an inline
 * `// eslint-disable...` comment anywhere in source, an `ignores` glob in either
 * `eslint.config.mjs`, and a rule pinned to `'off'` in either config. The DISCIPLINE this
 * check ports, not the tool call: enumerate every exemption mechanically, key each one so a
 * later run can tell "the same one" from "a new one", and make the comparison run in BOTH
 * directions against a dated, reasoned baseline — new is red, and STALE IS ALSO RED, because
 * a baseline that only ever forgives is a growing pile of permission, not a ratchet.
 *
 * WHAT COUNTS AS AN EXEMPTION, exactly:
 *
 *  1. Every `eslint-disable`, `eslint-disable-line`, `eslint-disable-next-line` and
 *     `eslint-enable` comment in every `.ts`/`.tsx` file under `backend/src` and
 *     `frontend/src` (tracked or freshly written-but-not-ignored — see `listSrcFiles`
 *     below). A block-scoped `eslint-disable` and its matching `eslint-enable` are each
 *     their OWN finding, at their own line: the disable is the exemption, and the enable is
 *     what proves someone bothered to close it instead of leaving the rule off for the rest
 *     of the file — both need a reason on record.
 *  2. Every `ignores` array literal in `backend/eslint.config.mjs` and
 *     `frontend/eslint.config.mjs`, whether it is the top-level "never lint this at all"
 *     block or a scoped block's own `ignores` (e.g. the money-arithmetic rules carving test
 *     files back out). One finding per `ignores:` OCCURRENCE (i.e. per line, per config
 *     object) — not per glob — the same granularity as a single disable comment that lists
 *     more than one rule.
 *  3. Every rule pinned to `'off'` — either `'rule/name': 'off'` or `'rule/name': ['off', …]`
 *     — anywhere in either config. None exist today (measured 2026-09-10); this exists so
 *     the FIRST one that ever lands is a finding, not a silent widening.
 *
 * Deliberately NOT scanned: `scripts/`, `.claude/hooks/`, anything outside
 * `backend/src`/`frontend/src`, and — obviously — this file and its own test, which
 * necessarily talk ABOUT `eslint-disable` in prose and fixture strings without that being a
 * real suppression of anything.
 *
 * KEY SHAPE: `file:line:directive:rules` — `file` is repo-root-relative with forward
 * slashes, `directive` is one of `eslint-disable(-line|-next-line)?`, `eslint-enable`,
 * `ignores` or `rule-off`, and `rules` is the rule name(s) / glob(s) that directive names
 * (comma-joined, in source order, when there is more than one — an empty string is valid
 * for a bare `/* eslint-disable *\/` that names no rule, i.e. disables everything).
 *
 * REJECTING STUB REASONS RUNS BEFORE ANY COMPARISON. A baseline entry whose `reason` is
 * missing, empty, or under 30 characters after trimming fails the check on its own, before
 * the current-tree scan is even compared against it — an entry that explains nothing is not
 * a reviewed exemption, it is a hole wearing the baseline's clothes. There is deliberately no
 * `--write` mode here: auto-filling a `reason` is exactly the shortcut this rule exists to
 * refuse. A new exemption's baseline entry is written once, by hand, by whoever read the
 * code and can say why the rule does not apply.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { errMessage } from '../hash.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const BASELINE_REL = 'scripts/verify/baselines/lint-exempt.json'
const BASELINE_PATH = path.join(ROOT, BASELINE_REL)

const SRC_ROOTS = ['backend/src', 'frontend/src']
const CONFIG_FILES = ['backend/eslint.config.mjs', 'frontend/eslint.config.mjs']

const MIN_REASON_LENGTH = 30

/**
 * @typedef {object} Finding
 * @property {string} file repo-root-relative, forward-slash separated
 * @property {number} line 1-based
 * @property {string} directive
 * @property {string} rules comma-joined rule names or globs, may be empty
 */

/**
 * @param {Finding} f
 * @returns {string}
 */
function keyOf(f) {
  return `${f.file}:${f.line}:${f.directive}:${f.rules}`
}

/**
 * Every `.ts`/`.tsx` file under a src root, tracked or untracked-but-not-ignored — the same
 * `-c -o --exclude-standard` combination `seam-boundary.mjs` and `scripts/verify/hash.mjs`
 * use, and for the same reason: a freshly written fixture that has not been `git add`ed yet
 * must still be seen, or a red-case test that only writes a file (never staging it) would
 * report a false green.
 *
 * @param {string} relRoot e.g. "backend/src"
 * @returns {string[]} repo-root-relative paths, forward-slash separated, sorted
 */
function listSrcFiles(relRoot) {
  const NUL = String.fromCharCode(0)
  /** @type {Buffer} */
  let raw
  try {
    raw = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z', '--', relRoot], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (err) {
    throw new Error(`lint-exempt: git could not enumerate ${relRoot}: ${errMessage(err)}`)
  }
  return raw
    .toString('utf8')
    .split(NUL)
    .filter((rel) => rel.endsWith('.ts') || rel.endsWith('.tsx'))
    .sort()
}

// Matches a directive comment only when the directive keyword is the very first thing in
// the comment (after optional whitespace) — the same requirement eslint itself imposes, so
// a prose comment that merely DISCUSSES `eslint-disable` elsewhere in a longer sentence is
// never mistaken for a real directive. Longest alternatives first: `disable-next-line` and
// `disable-line` must be tried before the bare `disable`, or the bare form would match a
// truncated prefix of the longer one and leave "-next-line"/"-line" as leftover "rules" text.
const DIRECTIVE_RE = /(?:\/\/|\/\*)\s*eslint-(disable-next-line|disable-line|disable|enable)\b(.*)$/

/**
 * @param {string} line
 * @returns {{ directive: string, rules: string } | null}
 */
function parseDirectiveLine(line) {
  const m = line.match(DIRECTIVE_RE)
  if (!m) return null
  let rest = m[2]
  // A block comment's closing `*/`.
  rest = rest.replace(/\*\/\s*$/, '')
  // ESLint's own directive-description syntax: `-- free text` trailing the rule list.
  const descIdx = rest.search(/\s--\s/)
  if (descIdx !== -1) rest = rest.slice(0, descIdx)
  return { directive: `eslint-${m[1]}`, rules: rest.trim() }
}

/**
 * @returns {Finding[]}
 */
function scanSourceComments() {
  /** @type {Finding[]} */
  const findings = []
  for (const relRoot of SRC_ROOTS) {
    for (const rel of listSrcFiles(relRoot)) {
      /** @type {string} */
      let text
      try {
        text = readFileSync(path.join(ROOT, rel), 'utf8')
      } catch (err) {
        // Same defensive stance as seam-boundary.mjs: this walks a live working tree, and a
        // file that vanished between listing and reading is not a finding, it's a race.
        const code = /** @type {{ code?: string }} */ (err).code
        if (code === 'ENOENT') continue
        throw new Error(`lint-exempt: ${rel} unreadable: ${errMessage(err)}`)
      }
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        const parsed = parseDirectiveLine(lines[i])
        if (!parsed) continue
        findings.push({ file: rel, line: i + 1, directive: parsed.directive, rules: parsed.rules })
      }
    }
  }
  return findings
}

/**
 * Every quoted string literal inside a slice of text, with each match's OFFSET WITHIN THAT
 * SLICE — the caller adds its own base offset to get an absolute file position.
 *
 * @param {string} slice
 * @returns {{ value: string, offset: number }[]}
 */
function quotedStringsWithOffsets(slice) {
  /** @type {{ value: string, offset: number }[]} */
  const out = []
  const re = /'([^']*)'|"([^"]*)"/g
  let m
  while ((m = re.exec(slice))) {
    out.push({ value: /** @type {string} */ (m[1] ?? m[2]), offset: m.index })
  }
  return out
}

/** @param {string} text @param {number} index @returns {number} 1-based line */
function lineAt(text, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) if (text[i] === '\n') line += 1
  return line
}

// One finding per `ignores:` occurrence (per config OBJECT), not per glob — see the file
// header. `[^[\]]*` deliberately refuses to match across a NESTED bracket: every `ignores`
// array in both configs today is a flat list of string literals, and if that ever stops
// being true, this regex failing to match is the right failure (a config-parsing gap
// surfacing as "found nothing", not as a silently wrong count).
const IGNORES_RE = /\bignores\s*:\s*\[([^[\]]*)\]/g

// A quoted rule name mapped directly to `'off'`, or to an array whose FIRST element is
// `'off'` (eslint's `[severity, ...options]` form). Rule names always contain `/` or `@`
// or a hyphen and must be quoted (bare identifiers can't spell them), so the quoted-key
// requirement has no false negatives against this repo's two configs. No trailing `\b`
// after `off` is needed to rule out `"office"`: the backreference (`\3`/`\4`) demands the
// SAME quote character immediately after the literal `off`, which a longer word could
// never supply — the quote itself is the boundary.
const RULE_OFF_RE = /(['"])([\w@/-]+)\1\s*:\s*(?:(['"])off\3|\[\s*(['"])off\4)/g

/**
 * @returns {Finding[]}
 */
function scanConfigFiles() {
  /** @type {Finding[]} */
  const findings = []
  for (const rel of CONFIG_FILES) {
    /** @type {string} */
    let text
    try {
      text = readFileSync(path.join(ROOT, rel), 'utf8')
    } catch (err) {
      throw new Error(`lint-exempt: ${rel} unreadable: ${errMessage(err)}`)
    }

    IGNORES_RE.lastIndex = 0
    let im
    while ((im = IGNORES_RE.exec(text))) {
      const globs = quotedStringsWithOffsets(im[1]).map((g) => g.value)
      if (globs.length === 0) continue
      findings.push({ file: rel, line: lineAt(text, im.index), directive: 'ignores', rules: globs.join(', ') })
    }

    RULE_OFF_RE.lastIndex = 0
    let rm
    while ((rm = RULE_OFF_RE.exec(text))) {
      findings.push({ file: rel, line: lineAt(text, rm.index), directive: 'rule-off', rules: rm[2] })
    }
  }
  return findings
}

/**
 * @returns {Finding[]} every current exemption, sorted for stable output
 */
function scanCurrentExemptions() {
  const findings = [...scanSourceComments(), ...scanConfigFiles()]
  findings.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  return findings
}

/**
 * @typedef {{ key: string, added: string, reason: string }} BaselineEntry
 * @typedef {{ createdAt: string, note: string, entries: BaselineEntry[] }} Baseline
 */

/**
 * Loads the baseline and validates it BEFORE any comparison against the current tree runs.
 * A stub reason (missing, empty, or under 30 characters trimmed) is a failure of the
 * BASELINE FILE ITSELF, reported on its own — an entry that explains nothing is not an
 * exemption on record, it is a hole with a `key` attached.
 *
 * @returns {{ baseline: Baseline, problems: string[] }}
 */
function loadAndValidateBaseline() {
  /** @type {string} */
  let raw
  try {
    raw = readFileSync(BASELINE_PATH, 'utf8')
  } catch (err) {
    throw new Error(`lint-exempt: ${BASELINE_REL} is missing or unreadable: ${errMessage(err)}`)
  }
  /** @type {any} */
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`lint-exempt: ${BASELINE_REL} is not valid JSON: ${errMessage(err)}`)
  }
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`lint-exempt: ${BASELINE_REL} has no "entries" array.`)
  }

  /** @type {string[]} */
  const problems = []
  const seenKeys = new Set()
  parsed.entries.forEach((/** @type {any} */ entry, /** @type {number} */ i) => {
    const label = `${BASELINE_REL} entries[${i}]`
    const key = entry?.key
    const added = entry?.added
    const reason = typeof entry?.reason === 'string' ? entry.reason.trim() : ''

    if (typeof key !== 'string' || !key) {
      problems.push(`${label}: missing a "key" string.`)
      return
    }
    if (seenKeys.has(key)) problems.push(`${label} (${key}): duplicate key in the baseline.`)
    seenKeys.add(key)

    if (typeof added !== 'string' || !added) {
      problems.push(`${label} (${key}): missing an "added" date.`)
    }
    if (!reason || reason.length < MIN_REASON_LENGTH) {
      problems.push(
        `${label} (${key}): "reason" is missing or shorter than ${MIN_REASON_LENGTH} characters — a stub ` +
          'reason is not an exemption, it is a hole. Read the code this key names and write a real one.',
      )
    }
  })

  return { baseline: parsed, problems }
}

function main() {
  const { baseline, problems: baselineProblems } = loadAndValidateBaseline()
  if (baselineProblems.length > 0) {
    process.stderr.write('lint-exempt: RED — the baseline itself is invalid\n')
    for (const p of baselineProblems) process.stderr.write(`  ${p}\n`)
    process.exit(1)
    return
  }

  /** @type {Finding[]} */
  let current
  try {
    current = scanCurrentExemptions()
  } catch (err) {
    process.stderr.write(`lint-exempt: RED\n  ${errMessage(err)}\n`)
    process.exit(1)
    return
  }

  const currentKeys = new Map(current.map((f) => [keyOf(f), f]))
  const baselineKeys = new Map(baseline.entries.map((e) => [e.key, e]))

  /** @type {string[]} */
  const problems = []

  for (const [key, f] of currentKeys) {
    if (!baselineKeys.has(key)) {
      problems.push(
        `NEW EXEMPTION: ${f.file}:${f.line} (${f.directive}${f.rules ? `: ${f.rules}` : ''}) — not in ` +
          `${BASELINE_REL}. A new lint exemption needs a dated entry there with a real, ≥${MIN_REASON_LENGTH}-` +
          'character reason before this check can pass — the baseline may only grow by a reviewed decision, ' +
          'never by drift.',
      )
    }
  }
  for (const key of baselineKeys.keys()) {
    if (!currentKeys.has(key)) {
      problems.push(
        `STALE ENTRY: ${key} — ${BASELINE_REL} records this exemption but it no longer exists in the code or ` +
          'config (removed, or its line moved). Delete the entry — this ratchet only shrinks, and a baseline ' +
          'that only ever forgives is not one.',
      )
    }
  }

  if (problems.length > 0) {
    process.stderr.write('lint-exempt: RED\n')
    for (const p of problems.sort()) process.stderr.write(`  ${p}\n`)
    process.exit(1)
    return
  }

  process.stdout.write(
    `lint-exempt: ${baseline.entries.length} lint exemptions on record, all present, none stale, every ` +
      `reason ≥${MIN_REASON_LENGTH} characters — matches ${BASELINE_REL} (${baseline.createdAt}) exactly\n`,
  )
}

main()
