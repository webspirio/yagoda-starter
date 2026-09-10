#!/usr/bin/env node
/**
 * Layer 2 — project-wide type-check, filtered to the files this turn modified. Advisory.
 *
 * ADAPTATION, stated rather than hidden: Claude Code has no "tool batch end" event. The
 * events are PreToolUse, PostToolUse, UserPromptSubmit, Notification, Stop, SubagentStop,
 * PreCompact, SessionStart, SessionEnd. So this runs on PostToolUse with a cooldown, which
 * approximates a batch boundary — it is not one. `tsc -b` takes ~2s here, so a per-edit
 * run would be affordable but noisy; the cooldown keeps it to roughly one run per batch.
 *
 * A second adaptation: this repo has four tsc projects (backend, frontend, scripts, e2e)
 * instead of one. Running all four on every batch would be correct but wasteful, so the
 * touched files are mapped to the project(s) they belong to and only those run.
 *
 * The modified-file list comes from NUL-delimited git output. Parsing git's default quoted
 * paths would break on any name with a space or a non-ASCII character, producing a filter
 * that matches nothing: tsc reports the error, the hook reports nothing, and the result
 * reads green.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const COOLDOWN_MS = 20_000
const STAMP = path.join(ROOT, '.verify', 'batch-typecheck.stamp')
const LOCK = path.join(ROOT, '.verify', 'batch-typecheck.lock')

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
  process.stdout.write(`${text}\n`)
}

/** @returns {Promise<Record<string, any>>} */
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
    setTimeout(() => resolve({}), 5000).unref()
  })
}

const input = await readInput()
const tool = input?.tool_name
if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit' && tool !== 'NotebookEdit') {
  process.exit(0)
}

// --- cooldown ---------------------------------------------------------------------
const now = Date.now()
try {
  const last = Number.parseInt(readFileSync(STAMP, 'utf8').trim(), 10)
  if (Number.isFinite(last) && now - last < COOLDOWN_MS) process.exit(0)
} catch {
  /* no stamp yet — run */
}
// Claim the slot ATOMICALLY. Read-then-write let concurrent PostToolUse hooks both pass the
// cooldown, and every tsc project run here can share build-info state under node_modules —
// two simultaneous `tsc -b` runs can leave a corrupt build-info, not just burn CPU.
try {
  mkdirSync(path.dirname(STAMP), { recursive: true })
  writeFileSync(LOCK, String(process.pid), { flag: 'wx' })
} catch {
  process.exit(0)
}
try {
  writeFileSync(STAMP, String(now))
} finally {
  try {
    rmSync(LOCK, { force: true })
  } catch {
    /* the next run's wx will fail and simply skip; a stale lock costs a skipped check */
  }
}

// --- which files did this turn touch? ---------------------------------------------
/** @returns {Set<string>} */
function modifiedFiles() {
  /** @type {Set<string>} */
  const out = new Set()
  // Built at runtime rather than typed as an escape literal: this environment has a known
  // failure mode where a typed unicode escape lands as the raw control byte instead, which
  // would make this very file inconsistent with its own recorded byte-scan.
  const NUL = String.fromCharCode(0)
  // -z gives NUL-delimited, unquoted paths. Without it a path with a space or Cyrillic
  // characters comes back quoted and every comparison below silently misses.
  const res = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], {
    cwd: ROOT,
    encoding: 'buffer',
    timeout: 15_000,
  })
  if (res.status !== 0 || !res.stdout) return out
  const fields = res.stdout.toString('utf8').split(NUL).filter(Boolean)
  // Porcelain v1 -z: each entry is "XY <path>"; a rename/copy adds ONE extra field holding
  // the original path with no status prefix. Slicing 3 characters off that bare field
  // mangled any path whose third character happened to be a space.
  let expectBarePath = false
  for (const field of fields) {
    if (expectBarePath) {
      expectBarePath = false
      out.add(field)
      continue
    }
    const status = field.slice(0, 2)
    const p = field.slice(3)
    if (/[RC]/.test(status)) expectBarePath = true
    out.add(p)
  }
  return out
}

const touched = modifiedFiles()

// --- map touched files to the tsc project(s) that cover them -----------------------
/**
 * @typedef {{
 *   id: string,
 *   match: (rel: string) => boolean,
 *   cwd: string,
 *   args: string[],
 * }} ProjectDef
 */

/** @type {ProjectDef[]} */
const PROJECTS = [
  {
    id: 'backend',
    match: (rel) => rel.startsWith('backend/') && /\.tsx?$/.test(rel),
    cwd: ROOT,
    args: ['tsc', '-p', 'backend/tsconfig.json', '--noEmit'],
  },
  {
    id: 'frontend',
    match: (rel) => rel.startsWith('frontend/') && /\.tsx?$/.test(rel),
    cwd: path.join(ROOT, 'frontend'),
    args: ['tsc', '-b'],
  },
  {
    id: 'scripts',
    match: (rel) => (rel.startsWith('scripts/') || rel.startsWith('.claude/hooks/')) && rel.endsWith('.mjs'),
    cwd: ROOT,
    args: ['tsc', '-p', 'tsconfig.scripts.json'],
  },
  {
    id: 'e2e',
    match: (rel) => (rel.startsWith('e2e/') || rel === 'playwright.config.ts') && /\.tsx?$/.test(rel),
    cwd: ROOT,
    args: ['tsc', '-p', 'tsconfig.e2e.json'],
  },
]

const projectsToRun = PROJECTS.filter((project) => {
  for (const rel of touched) {
    if (project.match(rel)) return true
  }
  return false
})

// Nothing this turn touched maps to a known tsc project (a .md edit, say) — nothing to check.
if (projectsToRun.length === 0) process.exit(0)

/** @param {string} output @returns {string[]} */
function tsErrorLines(output) {
  return output.split('\n').filter((l) => /\.tsx?\(\d+,\d+\): error TS/.test(l))
}

const results = projectsToRun.map((project) => {
  const res = spawnSync('npx', project.args, {
    cwd: project.cwd,
    encoding: 'utf8',
    timeout: 120_000,
    env: process.env,
  })
  return { project, res }
})

const unrunnable = results.filter(({ res }) => res.error || res.status === null)
const failing = results.filter(({ res }) => !res.error && res.status !== null && res.status !== 0)

if (unrunnable.length === 0 && failing.length === 0) process.exit(0)

const systemMessage = unrunnable
  .map(
    ({ project, res }) =>
      `batch-typecheck: could not run tsc for ${project.id} — this project was NOT checked ` +
      `(${res.error ? res.error.message : 'timeout'}).`,
  )
  .join('\n')

const sections = failing.map(({ project, res }) => {
  const all = tsErrorLines(`${res.stdout ?? ''}${res.stderr ?? ''}`)
  const mine = all.filter((l) => {
    const file = l.split('(')[0].trim()
    const rel = path.relative(ROOT, path.resolve(project.cwd, file))
    return touched.has(rel)
  })
  // If the only errors are in files this turn did not touch, say that instead of blaming
  // the turn for them — but never claim the tree is clean.
  const shown = mine.length ? mine : all
  const scopeNote = mine.length
    ? `${mine.length} of ${all.length} error(s) are in files touched this turn.`
    : `None of the ${all.length} error(s) are in files touched this turn; that tree was already red.`
  return `[${project.id}] tsc is red. ${scopeNote}\n\n${shown.slice(0, 30).join('\n')}`
})

const additionalContext = sections.length
  ? `${sections.join('\n\n')}\n\n` +
    `This is a warning, not a block — but the gate at the end of the turn will fail on this.`
  : ''

emit({
  // No `decision`: documented PostToolUse values are "block" or absent, and this is advisory.
  ...(systemMessage ? { systemMessage } : {}),
  ...(additionalContext ? { additionalContext } : {}),
})
process.exit(0)
