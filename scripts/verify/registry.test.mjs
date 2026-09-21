import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { CHECKS, PRECONDITIONS, checkById, inTier, tierCovers } from './registry.mjs'
import { DEFAULT_TIMEOUT_MS } from './run.mjs'
import { gitEnv } from './scan-root.mjs'

test('every check id is unique', () => {
  const ids = CHECKS.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('every check has a falsifiable-looking proves and a blindSpot', () => {
  for (const c of CHECKS) {
    // The 40-word FLOOR below subsumes the character floor this used to carry; what stays
    // here is only that both fields exist at all.
    assert.ok(typeof c.proves === 'string', `${c.id}: proves is missing`)
    assert.ok(typeof c.blindSpot === 'string', `${c.id}: blindSpot is missing`)
  }
})

test('every `after` names a check that exists', () => {
  const ids = new Set(CHECKS.map((c) => c.id))
  for (const c of CHECKS) {
    for (const dep of c.after ?? []) assert.ok(ids.has(dep), `${c.id} depends on unknown ${dep}`)
  }
})

test('every `supersedes` names a real check, in a tier that can actually contain it', () => {
  const ids = new Set(CHECKS.map((c) => c.id))
  for (const c of CHECKS) {
    for (const id of c.supersedes ?? []) {
      assert.ok(ids.has(id), `${c.id} supersedes unknown ${id}`)
      assert.notEqual(id, c.id, `${c.id} supersedes itself — that is a deletion, not a subsumption`)
      // A row can only remove another when both are in the same run, so a superseder in a
      // HIGHER tier than its target is the only arrangement that ever does anything: the
      // target keeps running in every tier below. The reverse (a fast row claiming a full
      // one) would be dead configuration — legal to the runner, but never true of any run.
      const target = /** @type {import('./registry.mjs').Check} */ (checkById(id))
      assert.ok(
        inTier(target.tier, c.tier),
        `${c.id} (${c.tier}) supersedes ${id} (${target.tier}), a row no run of its own tier contains`,
      )
    }
  }
})

test('every `needs` names a declared precondition, and needs is an array', () => {
  for (const c of CHECKS) {
    if (c.needs === undefined) continue
    assert.ok(Array.isArray(c.needs), `${c.id}: needs must be an array`)
    for (const n of c.needs) assert.ok(PRECONDITIONS[n], `${c.id} needs unknown precondition ${n}`)
  }
})

test('a fast check never depends on a full one — it could never be satisfied in a fast run', () => {
  const tierOf = new Map(CHECKS.map((c) => [c.id, c.tier]))
  for (const c of CHECKS.filter((x) => x.tier === 'fast')) {
    for (const dep of c.after ?? []) {
      assert.notEqual(tierOf.get(dep), 'full', `${c.id} (fast) depends on ${dep} (full)`)
    }
  }
})

test('checkById finds and misses', () => {
  assert.equal(checkById('lint')?.id, 'lint')
  assert.equal(checkById('nope'), undefined)
})

test('inTier: a fast run excludes full, a full run includes both', () => {
  assert.equal(inTier('fast', 'fast'), true)
  assert.equal(inTier('full', 'fast'), false)
  assert.equal(inTier('fast', 'full'), true)
  assert.equal(inTier('full', 'full'), true)
})

test('tierCovers: a green recorded at fast says nothing about full', () => {
  assert.equal(tierCovers('fast', 'fast'), true)
  assert.equal(tierCovers('full', 'fast'), true)
  assert.equal(tierCovers('fast', 'full'), false)
})

test('every declared timeoutMs is a positive finite number, and only slow rows declare one', () => {
  const declared = CHECKS.filter((c) => c.timeoutMs !== undefined)
  for (const c of declared) {
    const budget = c.timeoutMs
    assert.equal(typeof budget, 'number', `${c.id}: timeoutMs must be a number`)
    assert.ok(
      Number.isFinite(budget) && Number(budget) > 0,
      `${c.id}: timeoutMs must be finite and positive, got ${budget}`,
    )
    // A budget at or below the runner's own default would SHORTEN a row rather than give it
    // room, which is not what this field is for — see registry.mjs's note. Compared against
    // the IMPORTED default rather than a copy of the number: this assertion used to spell
    // out 120_000 by hand, so lowering the default to 60s would have left it silently
    // asserting against a value the runner no longer used.
    assert.ok(
      Number(budget) > DEFAULT_TIMEOUT_MS,
      `${c.id}: a timeoutMs at or below the runner's own ${DEFAULT_TIMEOUT_MS / 1000}s default gives the row nothing`,
    )
  }
  // Pinned so that adding a seventh is a deliberate edit here, not a side effect. Three
  // joined on 2026-09-16, when the default dropped 120s -> 60s: selfcheck and smoke because
  // neither fitted under it any more (selfcheck had in fact never fitted under the OLD one
  // either, at 67.3s against 120s, which is what prompted the whole re-measure), and audit
  // because its cost is the npm registry's rather than ours — see that row's own note.
  assert.deepEqual(
    declared.map((c) => c.id).sort(),
    ['audit', 'coverage', 'selfcheck', 'smoke', 'test', 'test:db'],
    'the set of rows with their own timeout budget changed — confirm the new one was measured, not guessed',
  )
})

/**
 * THE FOUR CLASS INVARIANTS THAT REPLACE SEVEN PINNED COUNTS.
 *
 * The test this replaces derived seven numbers from `git ls-files` and asserted each still
 * appeared in some row's prose. That was the right MECHANISM aimed at the wrong TARGET: it
 * pinned the seven figures that happened to be stale the day it was written, out of roughly
 * 230 in the file, and it made every ordinary commit that adds a test file a re-measurement
 * edit to this registry. Two counts that were wrong for far longer — a baseline's finding
 * total, and a per-kind breakdown a row derived from a stale figure — were outside it by
 * construction, because they came from a baseline rather than from the filesystem.
 *
 * A class invariant cannot be out of date, because it never names a number.
 */
const WORDS = (/** @type {string} */ s) => s.trim().split(/\s+/).filter(Boolean)

/** Drop `code spans`: a command, a glob or a regex written as a literal may contain digits. */
const prose = (/** @type {string} */ s) => s.replace(/`[^`]*`/g, ' ')

/** @type {readonly ['proves', 'blindSpot']} */
const FIELDS = ['proves', 'blindSpot']

test('every proves and blindSpot answers one question, in 40-80 words', () => {
  for (const c of CHECKS) {
    for (const field of FIELDS) {
      const n = WORDS(c[field]).length
      assert.ok(n >= 40, `${c.id}.${field}: ${n} words — under the floor; too thin to falsify`)
      assert.ok(
        n <= 80,
        `${c.id}.${field}: ${n} words — over the cap. This string prints in the blind-spot ` +
          'footer of EVERY green run; at this length nobody reads it, so the mechanism that ' +
          'exists to state what a green does NOT cover is functionally deleted by its own ' +
          'length. Answer only "does a green run cover the change I just made?" — history, ' +
          'dates and measurements belong in the commit message, where they cannot rot into ' +
          'a green check.',
      )
    }
  }
})

/**
 * A digit is allowed only where it is part of an IDENTIFIER, never a measurement: an issue
 * reference, a rule enumerator, a spec section, a semver, an advisory id, or a bare 0/1
 * ("exits 0", "collected by exactly one runner"). A file count, a test count, a percentage,
 * a duration or a size is banned outright.
 */
const IDENTIFIER_DIGIT = /^(#\d+|\(\d\)|§[\d.]+|\d+\.\d+\.\d+|GHSA-\S+|0|1)$/
const MEASUREMENT = /^\d[\d,_]*(\.\d+)?(%|s|ms|x|st|nd|rd|th|k|ki?b|mb)?$/i

test('no proves or blindSpot contains a hand-written measurement', () => {
  for (const c of CHECKS) {
    for (const field of FIELDS) {
      const hits = WORDS(prose(c[field]))
        .map((t) => t.replace(/^[^#(§0-9A-Za-z]+/, '').replace(/[^0-9A-Za-z%)]+$/, ''))
        .filter((t) => /\d/.test(t) && !IDENTIFIER_DIGIT.test(t) && MEASUREMENT.test(t))
      assert.deepEqual(
        hits,
        [],
        `${c.id}.${field}: hand-written measurement(s) ${hits.join(', ')}. Nothing can keep a ` +
          'number in prose true — no type checks it, no lint sees it, and the check that used ' +
          'to compare two copies of it was green over a row whose own arithmetic contradicted ' +
          'itself. Derive it at runtime and print it, or delete the sentence.',
      )
    }
  }
})

test('no proves or blindSpot carries a dated snapshot', () => {
  for (const c of CHECKS) {
    for (const field of FIELDS) {
      const dates = prose(c[field]).match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []
      assert.deepEqual(
        dates,
        [],
        `${c.id}.${field}: dated note ${dates.join(', ')}. A dated re-measurement is a ` +
          'commit-message fact; in this file it reads as current forever.',
      )
    }
  }
})

test("every row's cmd is runnable, and no verify-layer script is orphaned", () => {
  const pkg = JSON.parse(backendFile('package.json'))
  for (const c of CHECKS) {
    const script = /^npm (?:run )?([\w:-]+)(?:\s+-w\s+([\w-]+))?$/.exec(c.cmd)
    if (script) {
      const [, name, workspace] = script
      const manifest = workspace ? JSON.parse(backendFile(`${workspace}/package.json`)) : pkg
      assert.ok(
        manifest.scripts?.[name],
        `${c.id}: cmd is \`${c.cmd}\` but ${workspace ?? 'the root'} package.json has no ` +
          `"${name}" script — this row would report UNRUNNABLE on every run`,
      )
      continue
    }
    const direct = /^node (\S+)/.exec(c.cmd)
    assert.ok(direct, `${c.id}: cmd \`${c.cmd}\` is neither an npm script nor a node invocation`)
    assert.ok(existsSync(path.resolve(import.meta.dirname, '..', '..', direct[1])), `${c.id}: ${direct[1]} does not exist`)
  }

  // THE INVERSE, and the one that catches a deleted row leaving its check behind:
  // `ratchet:money` was removed from this registry and its script, its 502-line ratchet and
  // its 366-line baseline stayed — still enforced through `selfcheck`, where no row, no
  // table and no blind-spot footer could see it.
  const RUNNER = new Set(['verify', 'verify:full', 'verify:ci', 'verify:prepush'])
  const orphans = Object.entries(pkg.scripts)
    .filter(([name, cmd]) => String(cmd).includes('scripts/verify/') && !RUNNER.has(name))
    .map(([name]) => name)
    .filter((name) => !CHECKS.some((c) => c.cmd === `npm run ${name}` || c.cmd === `node ${String(pkg.scripts[name]).replace(/^node /, '')}`))
  assert.deepEqual(
    orphans,
    [],
    `these scripts invoke the verify layer but no registry row runs them: ${orphans.join(', ')}. ` +
      'Give each a row, or delete the script, its check and its baseline together.',
  )
})

test('the runner default still clears every row that inherits it, and that set is pinned', () => {
  // THE PROPERTY THE OTHER TEST CANNOT HOLD. Once both sides import DEFAULT_TIMEOUT_MS,
  // "a declared budget must exceed the default" compares the constant against itself and
  // can no longer notice the default drifting away from what the inheriting rows actually
  // cost. Raised by review of that very change, 2026-09-16.
  //
  // Cold CI readings, run 35011857830 — the coldest full run on record, with an empty
  // Turbo cache. Recorded as DATA, so raising the default without re-measuring is a
  // visible edit to this table rather than a one-character change somewhere else.
  const COLD_MS = {
    lint: 16_900,
    typecheck: 16_700,
    build: 14_600,
    'test:ci-scripts': 6_700,
    deadcode: 2_100,
    migrations: 968,
    // 'ratchet:money': 808 -- row removed 2026-09-18 at the user's request; see the note
    // in scripts/verify/baselines/money-rounding.json. The 808ms reading stays in git
    // history rather than here, because a budget for a row that no longer runs would fail
    // the deepEqual below on every run.
    secrets: 424,
    // LOCAL readings, not CI ones: both rows were added after run 35011857830 and have
    // never run on a CI runner, so there is no cold CI number to record yet. Measured
    // with `/usr/bin/time -p npm run <script>`, slowest of ten consecutive runs on the
    // laptop. For calibration on the same laptop and the same day, `migrations` read
    // 1020ms against its 968ms CI entry, so a CI reading for these is unlikely to be more
    // than about twice what is recorded here. Replace them with the real cold numbers
    // after the first full CI run.
    documents: 360,
    schema: 350,
    bundle: 188,
    testfiles: 158,
  }

  const inheriting = CHECKS.filter((c) => c.timeoutMs === undefined).map((c) => c.id)

  // A row added later inherits this budget silently. Pinning the set is what forces
  // whoever adds it to measure it first — the same discipline the declared budgets get.
  assert.deepEqual(
    inheriting.slice().sort(),
    Object.keys(COLD_MS).sort(),
    'a row started or stopped inheriting the runner default — measure it cold on CI and record it here',
  )

  const slowest = Math.max(...Object.values(COLD_MS))
  assert.ok(
    DEFAULT_TIMEOUT_MS > slowest * 2,
    `the default (${DEFAULT_TIMEOUT_MS / 1000}s) must clear the slowest inheriting row ` +
      `(${slowest / 1000}s) with real headroom — it is a hang detector, not a performance gate`,
  )
  // And the other direction, which is the one review actually asked for: a default raised
  // far past its own basis stops detecting anything. 10x the worst reading is the line.
  assert.ok(
    DEFAULT_TIMEOUT_MS < slowest * 10,
    `the default (${DEFAULT_TIMEOUT_MS / 1000}s) is more than 10x the slowest row that ` +
      `relies on it (${slowest / 1000}s) — re-measure, or give the slow rows their own budget`,
  )
})

/**
 * THE ASSERTION THAT REPLACES `ratchet:money`.
 *
 * With the money scanner gone, backend/eslint.config.mjs's `files` array is the ONLY net
 * standing between a `price * kg` and a frozen receipt. A hand-maintained list is exactly
 * the artefact this layer refuses to trust — so it is not read, it is CHECKED, against the
 * entities that declare which modules own money.
 *
 * Both sides are derived. Nothing here names a module, so nothing here can go stale.
 */
const backendFile = (/** @type {string} */ rel) =>
  readFileSync(path.resolve(import.meta.dirname, '..', '..', rel), 'utf8')

/** Module directories under backend/src whose entity declares a `numeric` column. */
function modulesOwningMoneyColumns() {
  const files = execFileSync('git', ['ls-files', 'backend/src'], {
    env: gitEnv(),
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f.endsWith('.entity.ts'))
  /** @type {Set<string>} */
  const mods = new Set()
  for (const f of files) {
    if (/type:\s*'numeric'/.test(backendFile(f))) mods.add(f.split('/')[2])
  }
  return mods
}

/** The module directories backend/eslint.config.mjs's money `files` array reaches. */
async function modulesUnderTheMoneyBan() {
  const cfg = (await import('../../backend/eslint.config.mjs')).default
  const block = cfg.find(
    (/** @type {any} */ b) => b?.rules?.['no-restricted-syntax'] && Array.isArray(b.files),
  )
  assert.ok(block, 'backend/eslint.config.mjs no longer has a no-restricted-syntax block with `files`')
  /** @type {string[]} */
  const entries = /** @type {any} */ (block).files
  return { entries, dirs: new Set(entries.map((f) => f.split('/')[1])) }
}

test('every backend module owning a money column is inside the eslint money ban', async () => {
  const owning = modulesOwningMoneyColumns()
  const { dirs } = await modulesUnderTheMoneyBan()
  const unguarded = [...owning].filter((m) => !dirs.has(m)).sort()
  assert.deepEqual(
    unguarded,
    [],
    `these backend modules declare a \`numeric\` column and are OUTSIDE the money ban in ` +
      `backend/eslint.config.mjs: ${unguarded.join(', ')}. Since ratchet:money was deleted ` +
      'that list is the only net over money arithmetic, so a module outside it is a column ' +
      'guarded by nothing. Add it to `files` — do not delete this test.',
  )
  assert.ok(owning.size > 0, 'derived ZERO modules owning a numeric column — the derivation broke')
})

test('no entry in the money ban matches nothing — a dead glob is a silent hole', async () => {
  const { entries } = await modulesUnderTheMoneyBan()
  const tracked = execFileSync('git', ['ls-files', 'backend/src'], {
    env: gitEnv(),
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .map((f) => f.replace(/^backend\//, ''))
  const dead = entries.filter((g) => !tracked.some((f) => path.matchesGlob(f, g)))
  assert.deepEqual(
    dead,
    [],
    `these money-ban globs match no tracked file: ${dead.join(', ')}. A renamed or deleted ` +
      'module leaves its glob behind, and the ban then silently covers nothing.',
  )
})

test('every workspace defines lint, typecheck and test — turbo skips a workspace that does not', () => {
  // `turbo lint` reports "Tasks: 1 successful, 1 total" and EXITS 0 when a workspace has no
  // lint script. So the `lint` row can be green having linted one workspace — and `lint` is
  // now the only money net, which makes that a money problem rather than hygiene.
  const root = JSON.parse(backendFile('package.json'))
  for (const ws of root.workspaces) {
    const pkg = JSON.parse(backendFile(`${ws}/package.json`))
    for (const task of ['lint', 'typecheck', 'test']) {
      assert.ok(
        pkg.scripts?.[task],
        `${ws}/package.json has no "${task}" script — \`turbo ${task}\` will skip that ` +
          'workspace silently and the row will still be green',
      )
    }
  }
})

/**
 * THE ONE THING ESLINT CANNOT POLICE ABOUT ITSELF: ITS OWN CONFIG.
 *
 * `ratchet:lint-exempt` covered three shapes eslint has no rule for — a widened top-level
 * `ignores` glob, a rule pinned to `'off'`, and the money block's `files` list shrinking.
 * `eslint-comments` sees comments in source and nothing else, so deleting that ratchet
 * without this leaves the config unwatched in the same branch that makes `lint` the only
 * money net. These assertions are ~25 lines against 655, and unlike the baseline they are
 * keyed on CONTENT rather than on a line number that moved four times in eight days.
 */
const eslintConfig = async (/** @type {string} */ ws) =>
  /** @type {any[]} */ ((await import(`../../${ws}/eslint.config.mjs`)).default)

test('the money ban still bans what it claims to ban', async () => {
  const cfg = await eslintConfig('backend')
  const block = cfg.find((b) => b?.rules?.['no-restricted-syntax'] && Array.isArray(b.files))
  assert.ok(block, 'the money block is gone from backend/eslint.config.mjs')
  const selectors = block.rules['no-restricted-syntax']
    .filter((/** @type {unknown} */ r) => typeof r === 'object')
    .map((/** @type {{selector: string}} */ r) => r.selector)
  for (const required of [
    'BinaryExpression[operator=/^[*/]$/]',
    'AssignmentExpression[operator=/^[*/]=$/]',
    "CallExpression[callee.name='Number']",
    "MemberExpression[property.name='toFixed']",
  ]) {
    assert.ok(
      selectors.includes(required),
      `the money ban no longer carries ${required}. Since ratchet:money was deleted this ` +
        'block is the only net over money arithmetic; removing a selector silently narrows it.',
    )
  }
  const globals = block.rules['no-restricted-globals'] ?? []
  const names = globals.filter((/** @type {unknown} */ g) => typeof g === 'object').map((/** @type {{name:string}} */ g) => g.name)
  assert.deepEqual(names.sort(), ['parseFloat', 'parseInt'])
})

test('neither config pins a rule off in its own source', () => {
  // Read the SOURCE, not the resolved config: `tseslint.configs.recommended` legitimately
  // turns `constructor-super` off, and a preset's decisions are not this repo's
  // suppressions. What this catches is a rule pinned off IN THESE TWO FILES — a suppression
  // with no comment, no reason and no location, invisible to every eslint-comments rule
  // because there is no comment to inspect. This is `ratchet:lint-exempt`'s RULE_OFF_RE,
  // kept as ten lines rather than 371 plus a line-keyed baseline.
  const RULE_OFF = /(['"])([\w@/-]+)\1\s*:\s*(?:(['"])off\3|0)\s*[,}]/g
  for (const ws of ['backend', 'frontend']) {
    const src = backendFile(`${ws}/eslint.config.mjs`)
    const hits = [...src.matchAll(RULE_OFF)].map((m) => m[2])
    assert.deepEqual(
      hits,
      [],
      `${ws}/eslint.config.mjs pins ${hits.join(', ')} to 'off'. Delete the rule, or scope ` +
        'the block with `files`, so the decision is where a reader can see it.',
    )
  }
})
