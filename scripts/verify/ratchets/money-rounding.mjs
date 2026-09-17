#!/usr/bin/env node
/**
 * Money must not leave `backend/src/common/money.ts` unrounded, anywhere in `backend/src`.
 *
 * `backend/eslint.config.mjs` bans `*`, `/`, `Number()`, `toFixed`, `parseInt` and
 * `parseFloat` — but only under the module trees its own `files` list names (eight of them
 * on 2026-09-15: intakes, payouts, shifts, supplier-balance, transfers, point-cash,
 * cash-counts, intake-top-ups), and it excludes `*.spec.ts` / `*.db-spec.ts` there. That
 * scoping is deliberate and correct (the config says why: a repo-wide ban would train
 * people to write disable comments). This ratchet is the same discipline applied to ALL of
 * `backend/src`: `price * kg` written in some other service compiles, reads fine at a
 * glance, and produces a wrong `amount` that §2.7 then freezes forever on a supplier's
 * printed receipt.
 *
 * IT NO LONGER CARVES THOSE MODULES OUT. Until 2026-09-15 it skipped the four trees eslint
 * covered when it was written, to avoid reporting what eslint already blocked. Two things
 * made that wrong: eslint's list had since grown to eight and this constant had not, so the
 * two scopes silently disagreed; and the carve-out meant a module DELETED from eslint's
 * `files` list would have been policed by neither. Measured before removing it — scanning
 * the whole of `backend/src` adds exactly ZERO findings, because eslint's ban is what keeps
 * those trees clean — so the overlap costs nothing and the blind spot is gone.
 *
 * THE RULE, per spec §4.2 — the decidable form, not a broader one. For each file in
 * `backend/src/**\/*.ts` outside `*.spec.ts` / `*.db-spec.ts`, collect:
 *
 *   - every `BinaryExpression` with operator `*` or `/`
 *   - every `CallExpression` calling `Number`, `parseInt` or `parseFloat`
 *   - every `PropertyAccessExpression` (MemberExpression) named `toFixed`
 *
 * An occurrence is CLEARED — provably non-monetary — when every one of its operands
 * (both sides of a binary expression, every call argument, or the object a member access
 * reads `.toFixed` off of) is EITHER a numeric literal (optionally signed, e.g. `-1`) OR an
 * identifier whose declaration — variable, parameter or property — SOMEWHERE IN THE SAME
 * FILE carries an explicit `number` type annotation or a numeric-literal initialiser. A
 * call with zero arguments (`Number()`) is vacuously cleared: there is no operand for it to
 * hide a monetary value in.
 *
 * Everything else is a finding, keyed `file:line:kind` (kind is `*`, `/`, `Number`,
 * `parseInt`, `parseFloat` or `toFixed` — the key deliberately omits the source column and
 * the expression text, so a key names "this occurrence", not "this occurrence phrased this
 * exact way"), COUNTED per key, and compared against `baselines/money-rounding.json` with
 * EXACT COUNTS in both directions — a partial fix (two of three sites cleaned up) is still
 * red, and a baseline entry whose occurrences have all disappeared is red too, so the stale
 * entry gets deleted. The ratchet only ever shrinks.
 *
 * IMPOSTER RESOLUTION. `Number`, `parseInt` and `parseFloat` are ordinary, unshadowed
 * globals in virtually every file — but a file that locally declares or imports something
 * under one of those three names (a function, a variable, a default or named import) is no
 * longer calling the global this ratchet exists to catch, so such a call is skipped
 * entirely rather than being mistaken for the real one. This is the same discipline the
 * reference implementation's `bindingsFor()` applies to `round2`/`sum`, adapted to this
 * file's simpler, single-file, no-formatter rule: resolve the binding before trusting the
 * name.
 *
 * PARSED WITH THE TYPESCRIPT COMPILER API (`ts.createSourceFile`), never a regex or a
 * string search — a `*` inside a comment or a string literal is not an operator, and a
 * regex has no notion of "this identifier's declaration, elsewhere in this same file."
 *
 * `--write` regenerates the baseline, keeping every existing entry's `reason` untouched by
 * key. A brand-new key is written with an empty `reason`, which then fails
 * `loadAndValidateBaseline()`'s stub check until a human reads the site and writes one —
 * adoption only, never an auto-filled excuse.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { errMessage } from '../hash.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const BASELINE_REL = 'scripts/verify/baselines/money-rounding.json'
const BASELINE_PATH = path.join(ROOT, BASELINE_REL)

const MIN_REASON_LENGTH = 30

const TARGET_GLOBALS = new Set(['Number', 'parseInt', 'parseFloat'])

/**
 * @typedef {object} Finding
 * @property {string} file repo-root-relative, forward-slash separated
 * @property {number} line 1-based
 * @property {string} kind '*' | '/' | 'Number' | 'parseInt' | 'parseFloat' | 'toFixed'
 * @property {string} text normalised source text, for humans only — never part of the key
 */

/** @param {Finding} f @returns {string} */
function keyOf(f) {
  return `${f.file}:${f.line}:${f.kind}`
}

/** @param {string} s @returns {string} */
function normalise(s) {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Every `.ts` file under `backend/src`, tracked or untracked-but-not-ignored — the same
 * `-c -o --exclude-standard` combination `seam-boundary.mjs` and `scripts/verify/hash.mjs`
 * use, and for the same reason: a freshly written fixture that has not been `git add`ed yet
 * must still be seen, or a red-case test that only writes a file would report a false green.
 *
 * @returns {string[]} repo-root-relative paths, forward-slash separated, sorted
 */
function listCandidateFiles() {
  const NUL = String.fromCharCode(0)
  /** @type {Buffer} */
  let raw
  try {
    raw = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z', '--', 'backend/src'], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (err) {
    throw new Error(`money-rounding: git could not enumerate backend/src: ${errMessage(err)}`)
  }
  return raw
    .toString('utf8')
    .split(NUL)
    .filter(Boolean)
    .filter((rel) => rel.endsWith('.ts'))
    .filter((rel) => !/\.(spec|db-spec)\.ts$/.test(rel))
    .sort()
}

/** @param {ts.Node} node @returns {ts.Node} unwraps `(expr)` to `expr`, recursively */
function unwrapParens(node) {
  let n = node
  while (ts.isParenthesizedExpression(n)) n = n.expression
  return n
}

/**
 * A numeric literal, optionally signed (`-1`, `+2`) — never a `bigint` literal (`1n`):
 * `backend/src/common/money.ts` itself works in bigint kopiykas on purpose (see its own
 * header), and that is a DIFFERENT claim from "this is a plain JS number, safe to multiply
 * or divide" — a bigint literal operand does not clear an occurrence here.
 *
 * @param {ts.Node} node
 * @returns {boolean}
 */
function isNumericLiteralLike(node) {
  const n = unwrapParens(node)
  if (ts.isNumericLiteral(n)) return true
  if (
    ts.isPrefixUnaryExpression(n) &&
    (n.operator === ts.SyntaxKind.MinusToken || n.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(n.operand)
  ) {
    return true
  }
  return false
}

/** @param {ts.TypeNode | undefined} typeNode @returns {boolean} */
function isNumberTypeNode(typeNode) {
  return !!typeNode && typeNode.kind === ts.SyntaxKind.NumberKeyword
}

/**
 * Every identifier this file declares — as a variable, a function/method/arrow parameter,
 * or a class property — that carries an explicit `number` type annotation OR a
 * numeric-literal initialiser. Scope-INSENSITIVE by design: this parses ONE file with no
 * binder and no type checker (see the check's blindSpot), so two same-named bindings with
 * different types in the same file are not distinguished — a documented simplification,
 * not an oversight. A name qualifies the instant ANY of its declarations in the file would.
 *
 * @param {ts.SourceFile} sf
 * @returns {Set<string>}
 */
function collectNumberIdentifiers(sf) {
  /** @type {Set<string>} */
  const set = new Set()
  /** @param {ts.Node} node */
  function consider(node) {
    if (!('name' in node)) return
    const name = /** @type {{ name?: ts.Node }} */ (node).name
    if (!name || !ts.isIdentifier(name)) return
    const typeNode = /** @type {{ type?: ts.TypeNode }} */ (node).type
    const initializer = /** @type {{ initializer?: ts.Expression }} */ (node).initializer
    if (isNumberTypeNode(typeNode) || (initializer && isNumericLiteralLike(initializer))) {
      set.add(name.text)
    }
  }
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node)) {
      consider(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return set
}

/**
 * `Number`, `parseInt` and `parseFloat` are ordinary globals in most files — but a file
 * that declares or imports something under one of those exact names is no longer calling
 * the global this ratchet bans, and a call through that name must not be mistaken for it.
 *
 * @param {ts.SourceFile} sf
 * @returns {Set<string>} the subset of TARGET_GLOBALS this file shadows
 */
function collectShadowedGlobals(sf) {
  /** @type {Set<string>} */
  const shadow = new Set()
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause
      if (clause.name && TARGET_GLOBALS.has(clause.name.text)) shadow.add(clause.name.text)
      const named = clause.namedBindings
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          if (TARGET_GLOBALS.has(el.name.text)) shadow.add(el.name.text)
        }
      }
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name &&
      TARGET_GLOBALS.has(node.name.text)
    ) {
      shadow.add(node.name.text)
    } else if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      ts.isIdentifier(node.name) &&
      TARGET_GLOBALS.has(node.name.text)
    ) {
      shadow.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return shadow
}

/**
 * @param {ts.Node} node
 * @param {Set<string>} numberIdents
 * @returns {boolean}
 */
function operandQualifies(node, numberIdents) {
  const n = unwrapParens(node)
  if (isNumericLiteralLike(n)) return true
  if (ts.isIdentifier(n) && numberIdents.has(n.text)) return true
  return false
}

/**
 * @param {string} rel repo-root-relative path
 * @returns {Finding[]}
 */
function scanFile(rel) {
  const abs = path.join(ROOT, rel)
  /** @type {string} */
  let text
  try {
    text = readFileSync(abs, 'utf8')
  } catch (err) {
    // This walks a live working tree (listCandidateFiles() is a snapshot, not a lock) —
    // same defensive stance as seam-boundary.mjs. A file gone by read time is not a
    // finding, it's a race; any other read failure is a real problem, surfaced by main().
    const code = /** @type {{ code?: string }} */ (err).code
    if (code === 'ENOENT') return []
    throw new Error(`money-rounding: ${rel} unreadable: ${errMessage(err)}`)
  }
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const numberIdents = collectNumberIdentifiers(sf)
  const shadow = collectShadowedGlobals(sf)

  /** @type {Finding[]} */
  const findings = []
  /** @param {ts.Node} node @returns {number} 1-based line */
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

  /** @param {ts.Node} node */
  function visit(node) {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken || node.operatorToken.kind === ts.SyntaxKind.SlashToken)
    ) {
      const kind = node.operatorToken.kind === ts.SyntaxKind.AsteriskToken ? '*' : '/'
      const cleared = operandQualifies(node.left, numberIdents) && operandQualifies(node.right, numberIdents)
      if (!cleared) findings.push({ file: rel, line: lineOf(node), kind, text: normalise(node.getText(sf)) })
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      TARGET_GLOBALS.has(node.expression.text) &&
      !shadow.has(node.expression.text)
    ) {
      const kind = node.expression.text
      const cleared = node.arguments.every((arg) => operandQualifies(arg, numberIdents))
      if (!cleared) findings.push({ file: rel, line: lineOf(node), kind, text: normalise(node.getText(sf)) })
    } else if (ts.isPropertyAccessExpression(node) && node.name.text === 'toFixed') {
      const cleared = operandQualifies(node.expression, numberIdents)
      if (!cleared) findings.push({ file: rel, line: lineOf(node), kind: 'toFixed', text: normalise(node.getText(sf)) })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return findings
}

/** @returns {Finding[]} every current finding, sorted for stable output */
function scan() {
  /** @type {Finding[]} */
  const findings = []
  for (const rel of listCandidateFiles()) findings.push(...scanFile(rel))
  findings.sort((a, b) => keyOf(a).localeCompare(keyOf(b)) || a.text.localeCompare(b.text))
  return findings
}

const PLACEHOLDER = /^(todo|fixme|tbd|n\/?a|xxx|\?+|-+|—+|wip|later|see above|same as above|as above|ok|fine|dead)\.?$/i

/** @param {unknown} reason @returns {string | null} */
function reasonProblem(reason) {
  if (typeof reason !== 'string') return 'reason is missing'
  const t = reason.trim()
  if (!t) return 'reason is empty'
  if (PLACEHOLDER.test(t)) return `reason is a stub (${JSON.stringify(t)})`
  if (t.length < MIN_REASON_LENGTH) return `reason is shorter than ${MIN_REASON_LENGTH} characters (${t.length})`
  return null
}

/**
 * @typedef {{ key: string, file: string, line: number, kind: string, occurrences: number, added: string, reason: string }} BaselineEntry
 * @typedef {{ createdAt: string, note: string, entries: BaselineEntry[] }} Baseline
 */

/**
 * Loads and structurally validates the baseline BEFORE any comparison against the current
 * tree runs — a stub `reason` is a failure of the baseline file itself, exactly like
 * lint-exempt.mjs's `loadAndValidateBaseline()`.
 *
 * @returns {{ baseline: Baseline, problems: string[] }}
 */
function loadAndValidateBaseline() {
  /** @type {string} */
  let raw
  try {
    raw = readFileSync(BASELINE_PATH, 'utf8')
  } catch (err) {
    throw new Error(`money-rounding: ${BASELINE_REL} is missing or unreadable: ${errMessage(err)}`)
  }
  /** @type {any} */
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`money-rounding: ${BASELINE_REL} is not valid JSON: ${errMessage(err)}`)
  }
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`money-rounding: ${BASELINE_REL} has no "entries" array.`)
  }

  /** @type {string[]} */
  const problems = []
  const seenKeys = new Set()
  parsed.entries.forEach((/** @type {any} */ entry, /** @type {number} */ i) => {
    const label = `${BASELINE_REL} entries[${i}]`
    const key = entry?.key
    if (typeof key !== 'string' || !key) {
      problems.push(`${label}: missing a "key" string.`)
      return
    }
    if (seenKeys.has(key)) problems.push(`${label} (${key}): duplicate key in the baseline.`)
    seenKeys.add(key)

    if (typeof entry?.added !== 'string' || !entry.added) {
      problems.push(`${label} (${key}): missing an "added" date.`)
    }
    if (typeof entry?.occurrences !== 'number' || !Number.isInteger(entry.occurrences) || entry.occurrences < 1) {
      problems.push(`${label} (${key}): "occurrences" must be a positive integer.`)
    }
    const problem = reasonProblem(entry?.reason)
    if (problem) {
      problems.push(
        `${label} (${key}): "reason" ${problem} — a stub reason is not an exemption, it is a hole. Read the ` +
          `code this key names and write a real one.`,
      )
    }
  })

  return { baseline: parsed, problems }
}

function main() {
  const write = process.argv.includes('--write')

  /** @type {Finding[]} */
  let findings
  try {
    findings = scan()
  } catch (err) {
    process.stderr.write(`money-rounding: RED\n  ${errMessage(err)}\n`)
    process.exit(1)
    return
  }

  /** @type {Map<string, number>} */
  const foundCounts = new Map()
  for (const f of findings) foundCounts.set(keyOf(f), (foundCounts.get(keyOf(f)) ?? 0) + 1)

  if (write) {
    /** @type {Baseline} */
    let existingBaseline
    try {
      existingBaseline = loadAndValidateBaseline().baseline
    } catch {
      existingBaseline = { createdAt: new Date().toISOString().slice(0, 10), note: '', entries: [] }
    }
    const existingReasons = new Map(existingBaseline.entries.map((e) => [e.key, e]))

    /** @type {Map<string, Finding & { occurrences: number }>} */
    const byKey = new Map()
    for (const f of findings) {
      const k = keyOf(f)
      const prev = byKey.get(k)
      if (prev) prev.occurrences += 1
      else byKey.set(k, { ...f, occurrences: 1 })
    }

    const entries = [...byKey.values()]
      .sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
      .map((f) => {
        const prior = existingReasons.get(keyOf(f))
        return {
          key: keyOf(f),
          file: f.file,
          line: f.line,
          kind: f.kind,
          occurrences: f.occurrences,
          added: prior?.added ?? new Date().toISOString().slice(0, 10),
          reason: prior?.reason ?? '',
        }
      })

    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify({ createdAt: existingBaseline.createdAt, note: existingBaseline.note, entries }, null, 2)}\n`,
    )
    process.stdout.write(
      `money-rounding: baseline rewritten — ${entries.length} keys, ` +
        `${entries.filter((e) => reasonProblem(e.reason)).length} without a usable reason\n`,
    )
    return
  }

  const { baseline, problems: baselineProblems } = loadAndValidateBaseline()
  if (baselineProblems.length > 0) {
    process.stderr.write('money-rounding: RED — the baseline itself is invalid\n')
    for (const p of baselineProblems) process.stderr.write(`  ${p}\n`)
    process.exit(1)
    return
  }

  /** @type {string[]} */
  const problems = []
  const baselineByKey = new Map(baseline.entries.map((e) => [e.key, e]))

  for (const [key, count] of foundCounts) {
    const entry = baselineByKey.get(key)
    if (!entry) {
      const f = findings.find((x) => keyOf(x) === key)
      problems.push(
        `NEW FINDING: ${f?.file}:${f?.line} (${f?.kind}) — \`${f?.text}\` is not in ${BASELINE_REL}. A new ` +
          'money/weight arithmetic site outside the four eslint-scoped modules needs a dated entry there with ' +
          `a real, >=${MIN_REASON_LENGTH}-character reason (or route it through backend/src/common/money.ts) ` +
          'before this check can pass.',
      )
      continue
    }
    if (entry.occurrences !== count) {
      problems.push(
        `COUNT CHANGED: ${key} — baseline says ${entry.occurrences}, the tree has ${count}. A partial fix does ` +
          'not count as a fix: either clear every remaining site or update the baseline to the new exact count.',
      )
    }
  }
  for (const entry of baseline.entries) {
    if (!foundCounts.has(entry.key)) {
      problems.push(
        `STALE ENTRY: ${entry.key} — ${BASELINE_REL} records this but it no longer appears in the tree. Delete ` +
          'the entry — this ratchet only shrinks, and a baseline that only ever forgives is not one.',
      )
    }
  }

  if (problems.length > 0) {
    process.stderr.write('money-rounding: RED\n')
    for (const p of problems.sort()) process.stderr.write(`  ${p}\n`)
    process.exit(1)
    return
  }

  process.stdout.write(
    `money-rounding: ${baseline.entries.length} baselined money/weight-arithmetic sites, all present at their ` +
      `exact counts, none stale — matches ${BASELINE_REL} (${baseline.createdAt})\n`,
  )
}

main()
