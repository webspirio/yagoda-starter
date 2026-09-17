#!/usr/bin/env node
/**
 * Dependency advisories, as a ratchet.
 *
 * `npm audit` was previously checked by nothing at all. The point is not the advisories
 * that exist today, whatever they turn out to be — it is that a future advisory in a
 * runtime-reachable dependency would otherwise be invisible.
 *
 * Two tiers of strictness, deliberately different:
 *
 *   - Anything of CRITICAL severity fails outright and CANNOT be baselined, no matter
 *     where it sits in the tree — see main()'s hard-floor loop. A critical is not
 *     something you get to write a reason for.
 *   - Everything else — INCLUDING an advisory reachable from the PRODUCTION dependency
 *     tree — is enumerated in a dated baseline with a reason, bidirectional as usual: a
 *     new advisory fails, and one that has been fixed (or that npm no longer reports)
 *     must be removed. A PRODUCTION-tree entry is held to a STRICTER bar than a dev-only
 *     one: its baseline entry must also carry a `productionRisk` object with three
 *     independently non-stub fields — `vulnerability` (what it is), `reachability`
 *     (whether/why it is reachable here) and `fix` (what fix exists and what blocks
 *     applying it) — see `productionRiskProblems()`. A production-tree advisory recorded
 *     with a missing or vague `productionRisk` fails this check exactly as hard as one
 *     never recorded at all.
 *
 * RULING R18 (2026-09-10, fix round 1): an earlier version of this file made a
 * production-tree advisory UNCONDITIONALLY unbaselineable. That was overruled: a row that
 * can never go green once such an advisory exists is not a gate, it is noise that teaches
 * people to ignore red. The floor keeps its teeth a different way — the advisory is
 * RECORDED, in the specific detail above, rather than silently forgiven — and whether to
 * actually FIX it (a nested per-parent `overrides` entry, a NestJS major upgrade, or a
 * formally accepted risk) is a repository-owner decision this verification layer does not
 * get to make on its own.
 *
 * This lives in the FULL tier, not the fast one, on purpose. Its verdict depends on the
 * npm registry's advisory database, which changes without anything changing in this repo
 * — so it must not be able to block a turn on an upstream event. `scripts/verify/registry.mjs`
 * gives this row `needs: ['npm-registry']`: an unreachable registry SKIPS the row rather
 * than reporting "no vulnerabilities found", and CI (`--no-skip`) turns that SKIP into a
 * failure, because CI is supposed to provide the environment. Neither of those two
 * behaviours lives in this file — they are `run.mjs`'s job, applied uniformly to every
 * row with a `needs` entry. This file only ever runs once the registry is already known
 * reachable.
 *
 * PACKAGE-NAME GRANULARITY, NOT ADVISORY-ID GRANULARITY. `npm audit --json`'s top-level
 * `vulnerabilities` object is keyed by PACKAGE NAME, and a single upstream advisory
 * cascades: every package that depends (even transitively) on the vulnerable one is
 * listed too, with its own `severity` but a `via` array of plain package-name strings
 * rather than an advisory object. This check follows that same granularity — a baseline
 * entry names a package, not a GHSA id — because that is the unit npm audit itself
 * reports comparably run over run; the tradeoff is documented in this file's blindSpot in
 * registry.mjs: several package names can all trace back to the exact same root advisory.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { errMessage } from '../hash.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const BASELINE_REL = 'scripts/verify/baselines/audit.json'
const BASELINE_PATH = path.join(ROOT, BASELINE_REL)

const MIN_REASON_LENGTH = 30

const PLACEHOLDER =
  /^(todo|fixme|tbd|n\/?a|xxx|\?+|-+|—+|wip|later|see above|same as above|as above|ok|fine|dead)\.?$/i

/** @param {string[]} lines @returns {never} */
function fail(lines) {
  process.stderr.write('audit: RED\n')
  for (const l of lines) process.stderr.write(`  ${l}\n`)
  process.exit(1)
}

/**
 * The set of package names reachable from `npm ls --omit=dev --all --json`, run from the
 * repo root — this is a single npm-workspaces tree spanning both `backend` and `frontend`,
 * exactly the tree `npm audit` itself reasons about. `npm ls` exits non-zero whenever the
 * tree has ANY finding to report (extraneous, invalid, or — irrelevant here — missing
 * peer deps), so its JSON is read off stdout the same defensive way `npm audit`'s is
 * below: a non-zero exit is not "nothing to read".
 *
 * @returns {Set<string>}
 */
function productionTree() {
  /** @type {Set<string>} */
  const names = new Set()
  let out = ''
  try {
    out = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8')
  } catch (err) {
    const e = /** @type {{ stdout?: Buffer }} */ (err)
    out = e.stdout?.toString('utf8') ?? ''
  }
  if (!out.trim()) return names
  /** @param {any} node */
  const walk = (node) => {
    for (const [name, dep] of Object.entries(node?.dependencies ?? {})) {
      names.add(name)
      walk(dep)
    }
  }
  try {
    walk(JSON.parse(out))
  } catch {
    // An unparseable tree is handled by the caller treating the set as empty — the same
    // "fail open toward MORE findings, never toward silently trusting nothing is
    // production" stance as an empty `out` above: an empty `prod` set can only ever make
    // MORE advisories look baselineable, never fewer, so a parse failure here cannot hide
    // a real production-tree advisory behind a false "not production" verdict — it can
    // only over-baseline, which the hard floor below still catches by other means only if
    // severity is critical. This mirrors the reference implementation's own tradeoff.
  }
  return names
}

/**
 * @typedef {{ name: string, severity: string, prod: boolean, title: string }} Advisory
 */

/**
 * @param {Set<string>} prod package names present in the production dependency tree
 * @returns {Advisory[]} sorted by name
 */
function advisories(prod) {
  let raw = ''
  try {
    raw = execFileSync('npm', ['audit', '--json'], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8')
  } catch (err) {
    // npm audit exits non-zero the instant it finds anything at all; the JSON is still on
    // stdout. Treating a non-zero exit as "audit failed to run" would silently read every
    // vulnerable tree as clean — exactly backwards.
    const e = /** @type {{ stdout?: Buffer }} */ (err)
    raw = e.stdout?.toString('utf8') ?? ''
    if (!raw.trim()) fail(['npm audit produced no output at all — this cannot be read as "nothing found".'])
  }
  /** @type {any} */
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    fail(['npm audit returned output that is not valid JSON — this cannot be read as "nothing found" either.'])
  }
  /** @type {Advisory[]} */
  const out = []
  for (const [name, v] of Object.entries(parsed.vulnerabilities ?? {})) {
    const vuln = /** @type {any} */ (v)
    if (vuln.severity === 'info') continue
    const title =
      (vuln.via ?? [])
        .filter((/** @type {any} */ x) => typeof x === 'object' && x.title)
        .map((/** @type {any} */ x) => x.title)[0] ?? '(no title — cascades from a dependency, not a direct advisory)'
    out.push({ name, severity: vuln.severity, prod: prod.has(name), title })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

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
 * Required, independently-checked explanation fields for a PRODUCTION-tree baseline
 * entry (R18). Each is run through the same `reasonProblem()` a plain `reason` gets, so
 * "not just the generic 30-character rule" becomes THREE independently-enforced,
 * non-stub fields rather than one free-text blob — a structural (schema-shape) check,
 * not a keyword search inside prose that could be gamed by stuffing the right words in.
 *
 * @typedef {{ vulnerability: string, reachability: string, fix: string }} ProductionRisk
 */
const PRODUCTION_RISK_FIELDS = /** @type {const} */ (['vulnerability', 'reachability', 'fix'])

/**
 * @param {any} entry a baseline entry, already known to name a currently production-tree,
 *   non-critical advisory
 * @returns {string[]} problems, or [] when `entry.productionRisk` is complete
 */
function productionRiskProblems(entry) {
  const risk = entry?.productionRisk
  if (!risk || typeof risk !== 'object') {
    return [
      'this advisory is reachable from the PRODUCTION dependency tree, so its baseline entry must carry a ' +
        '"productionRisk" object with non-stub "vulnerability", "reachability" and "fix" fields (see this ' +
        "file's header) — none is present.",
    ]
  }
  /** @type {string[]} */
  const problems = []
  for (const field of PRODUCTION_RISK_FIELDS) {
    const problem = reasonProblem(risk[field])
    if (problem) {
      problems.push(
        `productionRisk.${field} ${problem} — a production-tree advisory needs a REAL, specific answer there ` +
          "(see this file's header for what each field must say), not a placeholder.",
      )
    }
  }
  return problems
}

/**
 * @typedef {{ name: string, severity: string, added: string, reason: string, productionRisk?: ProductionRisk }} BaselineEntry
 * @typedef {{ createdAt: string, note: string, entries: BaselineEntry[] }} Baseline
 */

/**
 * Loads and structurally validates the baseline BEFORE any comparison against the current
 * tree runs — a stub `reason` or a missing `added` date is a failure of the baseline file
 * itself, the same discipline `ratchets/money-rounding.mjs`'s and `ratchets/lint-exempt.mjs`'s
 * own `loadAndValidateBaseline()` already apply.
 *
 * @returns {{ baseline: Baseline, problems: string[] }}
 */
function loadAndValidateBaseline() {
  /** @type {string} */
  let raw
  try {
    raw = readFileSync(BASELINE_PATH, 'utf8')
  } catch (err) {
    throw new Error(`audit: ${BASELINE_REL} is missing or unreadable: ${errMessage(err)}`)
  }
  /** @type {any} */
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`audit: ${BASELINE_REL} is not valid JSON: ${errMessage(err)}`)
  }
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`audit: ${BASELINE_REL} has no "entries" array.`)
  }

  /** @type {string[]} */
  const problems = []
  const seenNames = new Set()
  parsed.entries.forEach((/** @type {any} */ entry, /** @type {number} */ i) => {
    const label = `${BASELINE_REL} entries[${i}]`
    const name = entry?.name
    if (typeof name !== 'string' || !name) {
      problems.push(`${label}: missing a "name" string.`)
      return
    }
    if (seenNames.has(name)) problems.push(`${label} (${name}): duplicate name in the baseline.`)
    seenNames.add(name)

    if (typeof entry?.added !== 'string' || !entry.added) {
      problems.push(`${label} (${name}): missing an "added" date.`)
    }
    const problem = reasonProblem(entry?.reason)
    if (problem) {
      problems.push(
        `${label} (${name}): "reason" ${problem} — a stub reason is not an exemption, it is a hole. Read the ` +
          `advisory this name names and write a real one.`,
      )
    }
  })

  return { baseline: parsed, problems }
}

function main() {
  const write = process.argv.includes('--write')
  const prod = productionTree()
  const found = advisories(prod)

  if (write) {
    /** @type {Baseline} */
    let existingBaseline
    try {
      existingBaseline = loadAndValidateBaseline().baseline
    } catch {
      existingBaseline = { createdAt: new Date().toISOString().slice(0, 10), note: '', entries: [] }
    }
    const existing = new Map(existingBaseline.entries.map((e) => [e.name, e]))
    // Only a CRITICAL name is dead weight to write (see main()'s hard-floor loop below —
    // critical can never be baselined, full stop). A production-tree name IS written now
    // (R18): it needs a human to fill in `productionRisk`, scaffolded empty below, before
    // this check will accept it.
    const entries = found
      .filter((a) => a.severity !== 'critical')
      .map((a) => {
        const prior = existing.get(a.name)
        /** @type {BaselineEntry} */
        const entry = {
          name: a.name,
          severity: a.severity,
          added: prior?.added ?? new Date().toISOString().slice(0, 10),
          reason: prior?.reason ?? '',
        }
        if (a.prod) {
          entry.productionRisk = prior?.productionRisk ?? { vulnerability: '', reachability: '', fix: '' }
        }
        return entry
      })
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify({ createdAt: existingBaseline.createdAt || new Date().toISOString().slice(0, 10), note: existingBaseline.note, entries }, null, 2)}\n`,
    )
    process.stdout.write(`audit: baseline rewritten — ${entries.length} entries\n`)
    return
  }

  const { baseline, problems: baselineProblems } = loadAndValidateBaseline()
  if (baselineProblems.length > 0) {
    process.stderr.write('audit: RED — the baseline itself is invalid\n')
    for (const p of baselineProblems) process.stderr.write(`  ${p}\n`)
    process.exit(1)
    return
  }

  /** @type {string[]} */
  const problems = []

  // Hard floor: CRITICAL is never baselinable, independent of what the baseline file
  // says — a baseline entry for a critical name changes nothing here.
  for (const a of found) {
    if (a.severity === 'critical') {
      problems.push(
        `CRITICAL: ${a.name} — "${a.title}". A critical advisory is never baselined, for any reason: either ` +
          `update it or remove the dependency.`,
      )
    }
  }

  const baselineNames = new Set(baseline.entries.map((e) => e.name))
  const baselineByName = new Map(baseline.entries.map((e) => [e.name, e]))

  // Production-tree, non-critical advisories (R18): not an automatic failure, but held to
  // the stricter `productionRisk` bar — see this file's header and
  // `productionRiskProblems()`. Checked before the generic new/stale comparison below,
  // which explicitly skips these names (they are handled here, with more specific
  // messaging than a plain "NEW ADVISORY" would give).
  for (const a of found) {
    if (!a.prod || a.severity === 'critical') continue
    const entry = baselineByName.get(a.name)
    if (!entry) {
      problems.push(
        `PRODUCTION ADVISORY NOT BASELINED: ${a.severity} ${a.name} — "${a.title}" is reachable from the ` +
          `production dependency tree. Add a dated entry to ${BASELINE_REL} with a "productionRisk" object ` +
          `stating what the vulnerability is, whether/why it is reachable here, and what fix exists and what ` +
          `blocks applying it.`,
      )
      continue
    }
    for (const p of productionRiskProblems(entry)) {
      problems.push(`PRODUCTION ENTRY INCOMPLETE: ${a.name} — ${p}`)
    }
  }

  for (const a of found) {
    if (a.prod || a.severity === 'critical') continue
    if (!baselineNames.has(a.name)) {
      problems.push(
        `NEW ADVISORY: ${a.severity} ${a.name} — "${a.title}". Not in ${BASELINE_REL}. Either fix it, or add a ` +
          `dated entry there with a real reason why it is harmless here.`,
      )
    }
  }
  const foundNames = new Set(found.map((a) => a.name))
  for (const e of baseline.entries) {
    if (!foundNames.has(e.name)) {
      problems.push(
        `STALE ENTRY: ${e.name} — ${BASELINE_REL} records this but npm audit no longer reports it. Delete the ` +
          `entry — this ratchet only shrinks, a baseline that only ever forgives is not one.`,
      )
    }
  }

  if (problems.length) fail(problems.sort())

  const bySev = found.reduce((/** @type {Record<string, number>} */ acc, a) => {
    acc[a.severity] = (acc[a.severity] ?? 0) + 1
    return acc
  }, {})
  const prodCount = found.filter((a) => a.prod).length
  process.stdout.write(
    `audit: ${found.length} advisor${found.length === 1 ? 'y' : 'ies'} ` +
      `(${Object.entries(bySev).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}), all accounted for in ` +
      `${BASELINE_REL} (${baseline.createdAt})` +
      (prodCount
        ? ` — ${prodCount} reachable from the production tree, each RECORDED with a complete productionRisk ` +
          `entry, not fixed here (see ${BASELINE_REL})\n`
        : ', none in the production tree\n'),
  )
  process.stdout.write(
    'audit: NOTE — this verdict depends on the npm registry\'s advisory database, which changes without ' +
      'anything changing in this repo. That is exactly why this row lives in the full tier, needs ' +
      "['npm-registry'], and is never part of the fast tier.\n",
  )
}

main()
