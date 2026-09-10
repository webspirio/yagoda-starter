#!/usr/bin/env node
/**
 * Dead code as a ratchet, not a cleanup — the knip half of this layer.
 *
 * This is a fresh implementation, not a port. The reference (yagoda-crm, pinned at
 * 468e184, `scripts/verify/ratchets/dead-exports.mjs`) configures knip as a SINGLE project
 * (`{ entry, project }` at the top of `knip.json`). This repo is an npm workspaces
 * monorepo, so its `knip.json` nests those same two keys once per workspace instead:
 *
 *   { "workspaces": { "backend": { "entry": [...], "project": [...] },
 *                      "frontend": { "entry": [...], "project": [...] } } }
 *
 * The DISCIPLINE this check ports is unchanged: run knip, normalise its findings to stable
 * keys, and compare them against a dated, reasoned baseline in BOTH directions — a new
 * finding is red, and a baseline entry whose finding has disappeared is ALSO red, so the
 * stale entry gets deleted rather than left standing as a permanent licence. A baseline
 * only ever shrinks; it never becomes a place things go to be forgotten.
 *
 * WHAT COUNTS AS A SUPPRESSION, and why an ALLOW-LIST catches all of them at once:
 *
 *  1. Any key in `knip.json` other than `$schema`/`workspaces` at the top level, or other
 *     than `entry`/`project` inside a workspace object. knip's own schema (checked directly
 *     against `node_modules/knip/schema.json` for this exact installed version, 6.35.1 —
 *     the same "don't trust a hand-typed list, verify against the tool" lesson
 *     money-rounding.mjs's header credits to a prior review) lists eighteen top-level keys
 *     and eleven per-workspace keys beyond `entry`/`project`, among them `ignore`,
 *     `ignoreDependencies`, `ignoreExportsUsedInFile`, `ignoreBinaries` and
 *     `ignoreWorkspaces` — every one of those is a way to make a real finding vanish with a
 *     config edit nobody has to explain. Denying by allow-list means a suppression knob
 *     nobody on this task thought of still fails by default, rather than passing by
 *     default the way a hand-typed deny-list would.
 *  2. A second config file knip would also honour: `knip.jsonc`/`.ts`/`.js`/`.mjs`/`.cjs`,
 *     `.knip.json(c)`, at the repo root OR inside `backend/`/`frontend/` (knip resolves a
 *     per-workspace config file the same way it resolves the root one), or a `"knip"`
 *     section in any of the three `package.json` files knip reads it from. This check reads
 *     only `knip.json`, so any of those is an invisible bypass of everything above.
 *  3. A `@public`/`@internal`/`@alias`/`@beta`/`@alpha` JSDoc tag on an export. Verified
 *     empirically against this exact installed knip (see task-13-report.md): the identical
 *     unused export, reachable from an entry point, produces a finding with no tag and NO
 *     finding at all with `/** @public *\/` above it — a suppression with zero config
 *     change, so it is scanned for directly rather than trusted to stay unused.
 *
 * PARSED AS A LINE-ORIENTED TEXT SCAN for (3) — the same idiom `lint-exempt.mjs` and
 * `money-rounding.mjs` already use for their own "did someone widen the escape hatch"
 * checks — over every `.ts`/`.tsx` file `git ls-files -c -o --exclude-standard` finds under
 * `backend/src`/`frontend/src`, so a freshly written, not-yet-`git add`ed fixture is seen.
 *
 * THE GLOBS THEMSELVES ARE PART OF THE EXEMPTION SURFACE: narrowing a `project` glob, or
 * adding a `!` negation to it, hides findings with no banned key in sight. So `knip.json`'s
 * `workspaces.*.entry`/`workspaces.*.project` values are fingerprinted (SHA-256, first 16
 * hex chars) into the baseline; a glob edit that does not also update the recorded
 * fingerprint fails this check even when every other rule above passes.
 *
 * `--write` regenerates the baseline from knip's current findings, keeping every existing
 * entry's `reason` by key. A brand-new key is written with an empty `reason`, which then
 * fails `loadAndValidateBaseline()`'s stub check until a human reads the finding and writes
 * a real one — adoption and re-keying only, never a way to turn a red run green.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { errMessage } from '../hash.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const KNIP_CONFIG = path.join(ROOT, 'knip.json')
const KNIP_BIN = path.join(ROOT, 'node_modules', '.bin', 'knip')
const BASELINE_REL = 'scripts/verify/baselines/dead-exports.json'
const BASELINE_PATH = path.join(ROOT, BASELINE_REL)

const MIN_REASON_LENGTH = 30

/** knip.json: only these keys, at the top level and inside each workspace, respectively. */
const ALLOWED_TOP_LEVEL_KEYS = new Set(['$schema', 'workspaces'])
const ALLOWED_WORKSPACE_KEYS = new Set(['entry', 'project'])

/** Every other filename knip resolves a config from, checked at the root and per workspace. */
const OTHER_KNIP_CONFIG_BASENAMES = ['knip.jsonc', 'knip.ts', 'knip.js', 'knip.mjs', 'knip.cjs', '.knip.json', '.knip.jsonc']
const WORKSPACE_DIRS = ['backend', 'frontend']
/** knip also reads a `"knip"` field from any of these — root, or either workspace's own manifest. */
const PACKAGE_JSON_FILES = ['package.json', 'backend/package.json', 'frontend/package.json']

/** JSDoc tags knip honours by default — see the file header's point (3). */
const KNIP_SUPPRESSION_TAG_RE = /@(public|internal|alias|beta|alpha)\b/
const SRC_ROOTS = ['backend/src', 'frontend/src']

/** knip's issue-array names, mapped to the `kind` this check records. */
const KINDS = {
  files: 'file',
  exports: 'export',
  types: 'type',
  dependencies: 'dependency',
  devDependencies: 'devDependency',
  unlisted: 'unlisted',
  unresolved: 'unresolved',
  duplicates: 'duplicate',
  binaries: 'binary',
  enumMembers: 'enumMember',
  namespaceMembers: 'namespaceMember',
  optionalPeerDependencies: 'optionalPeerDependency',
}

/**
 * @typedef {object} Finding
 * @property {string} kind
 * @property {string} file
 * @property {string} name
 */

/** @param {Finding} f @returns {string} */
function keyOf(f) {
  return `${f.kind}|${f.file}|${f.name}`
}

const PLACEHOLDER = /^(todo|fixme|tbd|n\/?a|xxx|\?+|-+|—+|wip|later|see above|same as above|as above|ok|fine|dead)\.?$/i

/** @param {unknown} reason @returns {string | null} the problem, or null when acceptable */
function reasonProblem(reason) {
  if (typeof reason !== 'string') return 'is missing'
  const t = reason.trim()
  if (!t) return 'is empty'
  if (PLACEHOLDER.test(t)) return `is a stub (${JSON.stringify(t)})`
  if (t.length < MIN_REASON_LENGTH) return `is shorter than ${MIN_REASON_LENGTH} characters (${t.length})`
  return null
}

/**
 * Validates `knip.json` against the allow-list and checks for a second place to configure
 * knip. Returns every problem found (never just the first) plus the glob fingerprint, which
 * is `null` when the config itself is not clean enough to fingerprint meaningfully.
 *
 * @returns {{ problems: string[], fingerprint: string | null }}
 */
function checkConfig() {
  /** @type {unknown} */
  let cfg
  try {
    cfg = JSON.parse(readFileSync(KNIP_CONFIG, 'utf8'))
  } catch (err) {
    return { problems: [`knip.json could not be read or parsed: ${errMessage(err)}`], fingerprint: null }
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return { problems: ['knip.json must be a JSON object.'], fingerprint: null }
  }
  const cfgObj = /** @type {Record<string, unknown>} */ (cfg)

  /** @type {string[]} */
  const problems = []

  const topExtra = Object.keys(cfgObj).filter((k) => !ALLOWED_TOP_LEVEL_KEYS.has(k))
  if (topExtra.length) {
    problems.push(
      `knip.json has keys outside the allowed set at its top level: ${topExtra.join(', ')}. Only ` +
        `${[...ALLOWED_TOP_LEVEL_KEYS].join(', ')} are allowed — ignore, ignoreDependencies, ` +
        'ignoreExportsUsedInFile, ignoreBinaries, ignoreWorkspaces, and every other suppression or scoping knob ' +
        'either quiet a finding or narrow what knip can see; a finding belongs in the dated, reasoned baseline ' +
        'instead, never behind a config key nobody reads again.',
    )
  }

  const rawWorkspaces = cfgObj.workspaces
  if (!rawWorkspaces || typeof rawWorkspaces !== 'object' || Array.isArray(rawWorkspaces)) {
    problems.push('knip.json must have a "workspaces" object naming each workspace\'s entry/project globs.')
  }
  const workspaces = /** @type {Record<string, unknown>} */ (rawWorkspaces && typeof rawWorkspaces === 'object' ? rawWorkspaces : {})
  for (const [name, rawWsCfg] of Object.entries(workspaces)) {
    if (!rawWsCfg || typeof rawWsCfg !== 'object' || Array.isArray(rawWsCfg)) {
      problems.push(`knip.json workspaces.${name} must be an object.`)
      continue
    }
    const wsCfg = /** @type {Record<string, unknown>} */ (rawWsCfg)
    const wsExtra = Object.keys(wsCfg).filter((k) => !ALLOWED_WORKSPACE_KEYS.has(k))
    if (wsExtra.length) {
      problems.push(
        `knip.json workspaces.${name} has keys outside the allowed set: ${wsExtra.join(', ')}. Only entry and ` +
          "project may appear per workspace — everything else in knip's schema (ignore, ignoreDependencies, " +
          'ignoreExportsUsedInFile, ignoreBinaries, paths, ...) is a suppression or scoping knob banned here.',
      )
    }
  }

  const otherRootConfigs = OTHER_KNIP_CONFIG_BASENAMES.filter((f) => existsSync(path.join(ROOT, f)))
  if (otherRootConfigs.length) {
    problems.push(
      `found additional knip config file(s) at the repo root: ${otherRootConfigs.join(', ')}. This check reads ` +
        'only knip.json, so any other config file knip would also honour is an invisible bypass of every rule ' +
        'above.',
    )
  }
  for (const dir of WORKSPACE_DIRS) {
    const foundHere = OTHER_KNIP_CONFIG_BASENAMES.filter((f) => existsSync(path.join(ROOT, dir, f)))
    if (foundHere.length) {
      problems.push(
        `found additional knip config file(s) inside ${dir}/: ${foundHere.join(', ')}. knip resolves a ` +
          "per-workspace config file the same way it resolves the root one — this check does not read it.",
      )
    }
  }
  for (const rel of PACKAGE_JSON_FILES) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'))
      if (pkg && typeof pkg === 'object' && 'knip' in pkg) {
        problems.push(
          `${rel} has a "knip" section — knip reads a package.json#knip field (root or per-workspace) exactly ` +
            "as it reads knip.json, and this check does not look there. Move any real settings into knip.json's " +
            'entry/project, or remove the section.',
        )
      }
    } catch {
      // Missing or unreadable package.json is some other check's problem, not this one's.
    }
  }

  if (problems.length) return { problems, fingerprint: null }

  // The globs decide what knip can see: a narrowed `project`, or a `project` gaining a `!`
  // negation, hides findings with no suppression key at all — so they are fingerprinted.
  /** @type {Record<string, { entry: unknown, project: unknown }>} */
  const shape = {}
  for (const name of Object.keys(workspaces).sort()) {
    const wsCfg = /** @type {Record<string, unknown>} */ (workspaces[name])
    shape[name] = { entry: wsCfg.entry ?? null, project: wsCfg.project ?? null }
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16)
  return { problems: [], fingerprint }
}

/**
 * Every `.ts`/`.tsx` file under a src root, tracked or untracked-but-not-ignored — same
 * `-c -o --exclude-standard` combination `lint-exempt.mjs` and `money-rounding.mjs` use, and
 * for the same reason: a freshly written fixture that has not been `git add`ed yet must
 * still be seen.
 *
 * @param {string} relRoot e.g. "backend/src"
 * @returns {string[]}
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
    throw new Error(`deadcode: git could not enumerate ${relRoot}: ${errMessage(err)}`)
  }
  return raw
    .toString('utf8')
    .split(NUL)
    .filter((rel) => rel.endsWith('.ts') || rel.endsWith('.tsx'))
    .sort()
}

/**
 * Every export knip would otherwise report as unused, silenced instead by a JSDoc tag knip
 * honours by default (see the file header's point (3)).
 *
 * @returns {string[]}
 */
function taggedExports() {
  /** @type {string[]} */
  const hits = []
  for (const relRoot of SRC_ROOTS) {
    for (const rel of listSrcFiles(relRoot)) {
      /** @type {string} */
      let text
      try {
        text = readFileSync(path.join(ROOT, rel), 'utf8')
      } catch (err) {
        // This walks a live working tree — same defensive stance as lint-exempt.mjs and
        // money-rounding.mjs: a file gone by read time is a race, not a finding.
        const code = /** @type {{ code?: string }} */ (err).code
        if (code === 'ENOENT') continue
        throw new Error(`deadcode: ${rel} unreadable: ${errMessage(err)}`)
      }
      text.split('\n').forEach((line, i) => {
        // Only a JSDoc comment line counts: prose in a `//` comment or a string literal is
        // not a directive knip parses.
        if (/^\s*(?:\/\*\*|\*)/.test(line) && KNIP_SUPPRESSION_TAG_RE.test(line)) {
          hits.push(`${rel}:${i + 1} ${line.trim().slice(0, 70)}`)
        }
      })
    }
  }
  return hits
}

/** @returns {Finding[]} every current knip finding, sorted for stable output */
function knipFindings() {
  /** @type {string} */
  let raw
  try {
    raw = execFileSync(KNIP_BIN, ['--reporter', 'json'], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8')
  } catch (err) {
    // knip exits non-zero the moment it has ANY finding — the JSON report is still on
    // stdout. Only a genuinely empty stdout means it did not run at all.
    const e = /** @type {{ stdout?: Buffer }} */ (err)
    raw = e.stdout ? e.stdout.toString('utf8') : ''
    if (!raw.trim()) {
      throw new Error(`deadcode: knip did not run: ${errMessage(err)}`)
    }
  }
  /** @type {{ issues?: Record<string, unknown>[] }} */
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('deadcode: knip did not return valid JSON — a corrupted report cannot be read as "nothing found".')
  }
  /** @type {Finding[]} */
  const out = []
  for (const issue of parsed.issues ?? []) {
    const file = /** @type {string} */ (issue.file)
    for (const [arrayName, kind] of Object.entries(KINDS)) {
      const arr = issue[arrayName]
      if (!Array.isArray(arr)) continue
      for (const item of arr) {
        const name = typeof item === 'string' ? item : /** @type {{ name?: string }} */ (item)?.name
        if (!name) continue
        out.push({ kind, file, name })
      }
    }
  }
  out.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  return out
}

/**
 * @typedef {{ key: string, kind: string, file: string, name: string, added: string, reason: string }} BaselineEntry
 * @typedef {{ createdAt: string, note: string, configFingerprint?: string, entries: BaselineEntry[] }} Baseline
 */

/**
 * Loads and structurally validates the baseline BEFORE any comparison against the current
 * tree runs — a stub `reason` is a failure of the baseline file itself, exactly like
 * lint-exempt.mjs's and money-rounding.mjs's `loadAndValidateBaseline()`.
 *
 * @returns {{ baseline: Baseline, problems: string[] }}
 */
function loadAndValidateBaseline() {
  /** @type {string} */
  let raw
  try {
    raw = readFileSync(BASELINE_PATH, 'utf8')
  } catch (err) {
    throw new Error(`deadcode: ${BASELINE_REL} is missing or unreadable: ${errMessage(err)}`)
  }
  /** @type {any} */
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`deadcode: ${BASELINE_REL} is not valid JSON: ${errMessage(err)}`)
  }
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`deadcode: ${BASELINE_REL} has no "entries" array.`)
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
    const problem = reasonProblem(entry?.reason)
    if (problem) {
      problems.push(
        `${label} (${key}): "reason" ${problem} — a stub reason is not an exemption, it is a hole. Read the ` +
          'finding this key names and write a real one.',
      )
    }
  })

  return { baseline: parsed, problems }
}

function main() {
  const write = process.argv.includes('--write')
  const today = new Date().toISOString().slice(0, 10)

  const { problems: configProblems, fingerprint } = checkConfig()
  if (configProblems.length) {
    process.stderr.write('deadcode: RED — knip.json is not compliant\n')
    for (const p of configProblems) process.stderr.write(`  ${p}\n`)
    process.exit(1)
    return
  }

  /** @type {string[]} */
  let tagged
  /** @type {Finding[]} */
  let found
  try {
    tagged = taggedExports()
    found = knipFindings()
  } catch (err) {
    process.stderr.write(`deadcode: RED\n  ${errMessage(err)}\n`)
    process.exit(1)
    return
  }

  const foundByKey = new Map(found.map((f) => [keyOf(f), f]))

  if (write) {
    /** @type {Baseline} */
    let existing
    try {
      existing = loadAndValidateBaseline().baseline
    } catch {
      existing = { createdAt: today, note: '', entries: [] }
    }
    const priorByKey = new Map(existing.entries.map((e) => [e.key, e]))
    const entries = found
      .map((f) => {
        const key = keyOf(f)
        const prior = priorByKey.get(key)
        return {
          key,
          kind: f.kind,
          file: f.file,
          name: f.name,
          added: prior?.added ?? today,
          reason: prior?.reason ?? '',
        }
      })
      .sort((a, b) => a.key.localeCompare(b.key))
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify(
        { createdAt: existing.createdAt ?? today, note: existing.note ?? '', configFingerprint: fingerprint, entries },
        null,
        2,
      )}\n`,
    )
    const missing = entries.filter((e) => reasonProblem(e.reason)).length
    process.stdout.write(`deadcode: baseline rewritten — ${entries.length} entries, ${missing} without a usable reason\n`)
    return
  }

  const { baseline, problems: baselineProblems } = loadAndValidateBaseline()
  if (baselineProblems.length) {
    process.stderr.write('deadcode: RED — the baseline itself is invalid\n')
    for (const p of baselineProblems) process.stderr.write(`  ${p}\n`)
    process.exit(1)
    return
  }

  /** @type {string[]} */
  const problems = []

  if (baseline.configFingerprint !== fingerprint) {
    problems.push(
      `GLOBS CHANGED: knip.json's entry/project values differ from what ${BASELINE_REL} recorded ` +
        `(${baseline.configFingerprint ?? 'none'} -> ${fingerprint}). Narrowing what knip can see is exactly as ` +
        'much a suppression as a banned config key. If the change is deliberate, rerun with --write and read ' +
        'every finding it adds or removes before committing.',
    )
  }

  for (const t of tagged) {
    problems.push(
      `SUPPRESSION TAG: ${t} — knip honours @public/@internal/@alias/@beta/@alpha by default, so this export ` +
        'disappears from the findings with no config change at all.',
    )
  }

  const baselineByKey = new Map(baseline.entries.map((e) => [e.key, e]))
  for (const f of found) {
    if (!baselineByKey.has(keyOf(f))) {
      problems.push(
        `NEW FINDING: ${f.kind} ${f.name} in ${f.file} — not in ${BASELINE_REL}. A new dead-code finding needs ` +
          `a dated entry there with a real, >=${MIN_REASON_LENGTH}-character reason — read the finding before ` +
          'writing one — before this check can pass.',
      )
    }
  }
  for (const e of baseline.entries) {
    if (!foundByKey.has(e.key)) {
      problems.push(
        `STALE ENTRY: ${e.kind} ${e.name} in ${e.file} — knip no longer reports this. Delete the entry: this ` +
          'ratchet only shrinks, and a baseline that only ever forgives is not one.',
      )
    }
  }

  if (problems.length) {
    process.stderr.write('deadcode: RED\n')
    for (const p of problems.sort()) process.stderr.write(`  ${p}\n`)
    process.exit(1)
    return
  }

  /** @type {Record<string, number>} */
  const byKind = {}
  for (const e of baseline.entries) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1
  const breakdown = Object.entries(byKind)
    .sort()
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
  process.stdout.write(
    `deadcode: ${baseline.entries.length} dead-code findings on record, all present, none stale, every reason ` +
      `>=${MIN_REASON_LENGTH} characters — matches ${BASELINE_REL} (${baseline.createdAt}) exactly (${breakdown})\n`,
  )
  process.stdout.write(
    `deadcode: knip.json carries only entry/project (fingerprint ${fingerprint}), no other knip config file ` +
      'exists, and no @public/@internal/@alias/@beta/@alpha suppression tag is present\n',
  )
}

main()
