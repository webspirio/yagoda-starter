#!/usr/bin/env node
/**
 * The invariants of an append-only schema (root CLAUDE.md, "Data": "migrations run
 * automatically on startup"). A migration that has already run on a real database and is
 * then hand-edited is how staging and production silently diverge from each other and
 * from git history -- this check is the mechanism that keeps that from happening quietly.
 *
 * Four rules, over `backend/src/**` and `backend/src/migrations/`:
 *
 *  1. `synchronize` is `false` at every occurrence under `backend/src/**`. AST: any
 *     `PropertyAssignment` (or `ShorthandPropertyAssignment`) named `synchronize` whose
 *     value is not the literal `false` keyword is a finding. PARSED WITH THE TYPESCRIPT
 *     COMPILER API (`ts.createSourceFile`), not a regex, deliberately: `synchronize:
 *     false` can be written across lines inside a larger object literal (it is, in both
 *     real occurrences -- `app.module.ts`'s `TypeOrmModule.forRootAsync` factory and
 *     `testing/db-harness.ts`'s `DataSource` options are each many lines long), and a
 *     regex would ALSO match the same text sitting inside a comment or a string, which
 *     proves nothing about what TypeORM actually receives at runtime.
 *  2. Migration filenames (direct children of `backend/src/migrations/`) match
 *     `/^(\d{13})-([A-Za-z0-9]+)\.ts$/`, with its five `*.db-spec.ts` files -- hand-written
 *     Jest suites in the same directory, never migrations TypeORM would load -- excluded
 *     from that requirement. ANY OTHER FILE in that directory (neither shape) is a finding:
 *     `backend/src/migrations/` holds exactly two kinds of thing, and a stray third file is
 *     worth flagging on its own merits, not waved through. Because the timestamp prefix is
 *     a FIXED-WIDTH 13-digit string, sorting filenames alphabetically and sorting by
 *     timestamp value agree exactly -- so "timestamps are strictly ascending with no
 *     duplicates" reduces to one check: no two files may capture the same 13-digit
 *     timestamp. (Two files CAN share a timestamp on disk -- the name half of the filename
 *     still differs -- which is exactly the case this rule exists to catch: an out-of-order
 *     or reused timestamp is a duplicate the filesystem alone will not stop you from
 *     creating.)
 *  3. The exported class name equals the filename's name-plus-timestamp, e.g.
 *     `1788600000000-InitialSchema.ts` exports `class InitialSchema1788600000000`. See
 *     the note above `EXPECTED_CLASS_NAME` for why this check uses name+timestamp rather
 *     than the name alone.
 *  4. ALREADY-MERGED MIGRATIONS ARE FROZEN. For each migration file that also exists in
 *     `origin/main` (`git cat-file -e origin/main:<path>`), its current content must be
 *     byte-identical to that version (`git diff --quiet origin/main -- <path>`). A
 *     migration with no counterpart in `origin/main` yet is a new one -- normal, and
 *     green, nothing to compare it against.
 *
 *     If `origin/main` is not a resolvable ref (never fetched, or no such remote), rule 4
 *     SKIPS -- loudly, not silently: it prints a line starting with the literal word
 *     `WARNING`, to stdout, on every run where this happens, PASSING or FAILING. The
 *     runner's own `warningLines()` (`scripts/verify/run.mjs`) surfaces any line matching
 *     `/WARNING|\(!\)/` from a check's output even when that check's exit code is 0 --
 *     exactly so a green `migrations` row can never be read as "rule 4 ran and passed"
 *     when rule 4 did not run at all.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { errMessage } from '../hash.mjs'
import { gitEnv, refuseEmptyScan, scanRoot } from '../scan-root.mjs'

/**
 * The tree this check scans. Overridable with `--root <dir>` / VERIFY_SCAN_ROOT so this
 * check's own fixture tests run against a mkdtempSync directory instead of planting
 * migrations in the real backend/src — including, until this commit, an in-place edit to an
 * already-merged migration, restored only in a `finally`. That is precisely the divergence
 * rule 4 exists to catch, caused by the test for rule 4.
 */
const ROOT = scanRoot()
const BACKEND_SRC = path.join(ROOT, 'backend', 'src')
const MIGRATIONS_DIR = path.join(BACKEND_SRC, 'migrations')
const MIGRATIONS_REL = path.relative(ROOT, MIGRATIONS_DIR)

/** Rule 2's whole filename contract: group 1 is the 13-digit timestamp, group 2 is the name. */
const MIGRATION_FILENAME_RE = /^(\d{13})-([A-Za-z0-9]+)\.ts$/
/** The five hand-written Jest suites that live alongside the migrations but are not one. */
const DB_SPEC_RE = /\.db-spec\.ts$/

/**
 * Rule 3's expected name. TypeORM's own CLI (`typeorm migration:generate`, the tool
 * `backend/CLAUDE.md`'s "Workflow for schema changes" tells a developer to run) emits
 * `class <Name><Timestamp>` -- confirmed against all 8 files in this repo today, e.g.
 * `1788600000000-InitialSchema.ts` exports `InitialSchema1788600000000`, not bare
 * `InitialSchema`. Checking name-plus-timestamp (rather than the name half alone) is what
 * keeps every migration that already exists green while still catching a genuinely wrong
 * class name -- a class named for the wrong migration, a typo, or a copy-paste that forgot
 * to rename.
 *
 * @param {string} name filename's second capture group
 * @param {string} timestamp filename's first capture group
 * @returns {string}
 */
function expectedClassName(name, timestamp) {
  return `${name}${timestamp}`
}

/**
 * Every `.ts` file under `backend/src`, tracked or untracked-but-not-ignored -- same
 * `-c -o --exclude-standard` combination the other AST-based checks in this layer use
 * (`seam-boundary.mjs`), so a freshly written fixture file is seen by rule 1 even before
 * it is ever `git add`ed.
 *
 * @returns {string[]} absolute paths, sorted
 */
function listBackendSrcFiles() {
  const NUL = String.fromCharCode(0)
  /** @type {Buffer} */
  let raw
  try {
    raw = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z', '--', 'backend/src'], {
      cwd: ROOT,
      env: gitEnv(),
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (err) {
    throw new Error(`migrations: git could not enumerate backend/src files: ${errMessage(err)}`)
  }
  return raw
    .toString('utf8')
    .split(NUL)
    .filter(Boolean)
    .map((rel) => path.join(ROOT, rel))
    .sort()
}

/**
 * The `.ts` subset, which is what rule 1 parses.
 *
 * @returns {string[]} absolute paths, sorted
 */
function listBackendSrcTsFiles() {
  return listBackendSrcFiles().filter((abs) => abs.endsWith('.ts'))
}

/**
 * Rule 1. A `PropertyAssignment` or `ShorthandPropertyAssignment` named `synchronize`
 * whose value is not the bare `false` keyword. A shorthand form (`{ synchronize }`, value
 * supplied by a same-named variable in scope) can never statically prove `false` either,
 * so it is a finding too -- nothing in this repo writes `synchronize` that way today, but
 * the rule is "not the literal `false`", not "not literally `true`".
 *
 * @param {ts.SourceFile} sourceFile
 * @returns {{ line: number, text: string }[]}
 */
function findSynchronizeFindings(sourceFile) {
  /** @type {{ line: number, text: string }[] } */
  const hits = []
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'synchronize') {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      hits.push({ line: line + 1, text: node.getText(sourceFile) })
    } else if (ts.isPropertyAssignment(node)) {
      const nameNode = node.name
      const propName = ts.isIdentifier(nameNode) || ts.isStringLiteralLike(nameNode) ? nameNode.text : null
      if (propName === 'synchronize' && node.initializer.kind !== ts.SyntaxKind.FalseKeyword) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        hits.push({ line: line + 1, text: node.initializer.getText(sourceFile) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return hits
}

/**
 * Rule 3's source: every exported class name declared in a migration file. Normally
 * exactly one; collected as a list (rather than "the first one") so a file with more than
 * one exported class is still checked correctly against all of them.
 *
 * @param {ts.SourceFile} sourceFile
 * @returns {string[]}
 */
function findExportedClassNames(sourceFile) {
  /** @type {string[]} */
  const names = []
  /** @param {ts.Node} node */
  function visit(node) {
    if (
      ts.isClassDeclaration(node) &&
      node.name &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      names.push(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
}

/**
 * Rule 4's gate. `git rev-parse --verify -q` exits 0 with the SHA on stdout when the ref
 * resolves, non-zero (silently, thanks to `-q`) when it does not -- the same shape as an
 * unfetched remote-tracking branch or a repository with no `origin` at all.
 *
 * @returns {boolean}
 */
function originMainIsResolvable() {
  try {
    execFileSync('git', ['rev-parse', '--verify', '-q', 'origin/main'], {
      cwd: ROOT,
      env: gitEnv(),
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * @param {string} relPath repo-root-relative, forward-slash path
 * @returns {boolean}
 */
function existsInOriginMain(relPath) {
  try {
    execFileSync('git', ['cat-file', '-e', `origin/main:${relPath}`], {
      cwd: ROOT,
      env: gitEnv(),
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * `git diff --quiet` exits 0 for no difference, 1 for a real difference, and anything else
 * for a genuine git failure -- kept distinct from "differs" so a git error is reported as
 * an error, not silently read as a content change.
 *
 * @param {string} relPath
 * @returns {boolean} true when byte-identical to origin/main's copy
 */
function unchangedFromOriginMain(relPath) {
  try {
    execFileSync('git', ['diff', '--quiet', 'origin/main', '--', relPath], {
      cwd: ROOT,
      env: gitEnv(),
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    return true
  } catch (err) {
    const e = /** @type {{ status?: number }} */ (err)
    if (e.status === 1) return false
    throw new Error(`migrations: git diff against origin/main failed for ${relPath}: ${errMessage(err)}`)
  }
}

/**
 * Rule 4b's baseline ref: the COMMON ANCESTOR of this tree and origin/main, never
 * origin/main itself.
 *
 * A tree that is merely BEHIND — the normal state of a feature branch, and of this repo's
 * own main on the day this was written, where origin/main carried two migrations HEAD had
 * never seen — legitimately lacks migrations origin/main already has. Keying 4b on
 * origin/main would report "a merged migration was deleted" on every branch one pull
 * behind, which is a red fast tier for a correct tree.
 *
 * @returns {string|null} a commit SHA, or null when there is no reachable merge-base
 *   (a shallow clone, or unrelated histories)
 */
function mergeBaseWithOriginMain() {
  try {
    return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], {
      cwd: ROOT,
      env: gitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * Every MIGRATION path present at `ref`. `*.db-spec.ts` files are deliberately excluded:
 * they are ordinary Jest suites and deleting one is legitimate work, not divergence.
 *
 * @param {string} ref
 * @returns {string[]} repo-root-relative, forward-slash, sorted
 */
function migrationsAtRef(ref) {
  const NUL = String.fromCharCode(0)
  /** @type {Buffer} */
  let raw
  try {
    raw = execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', ref, '--', `${MIGRATIONS_REL}/`], {
      cwd: ROOT,
      env: gitEnv(),
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch (err) {
    throw new Error(`migrations: git ls-tree ${ref} failed: ${errMessage(err)}`)
  }
  return raw
    .toString('utf8')
    .split(NUL)
    .filter(Boolean)
    .filter((rel) => MIGRATION_FILENAME_RE.test(path.basename(rel)))
    .sort()
}

/**
 * @typedef {object} Candidate
 * @property {string} file basename
 * @property {string} timestamp 13-digit capture
 * @property {string} name capture group 2
 */

/**
 * @returns {{ findings: string[], warnings: string[] }}
 */
function scan() {
  /** @type {string[]} */
  const findings = []
  /** @type {string[]} */
  const warnings = []

  // Rule 1: synchronize is false everywhere under backend/src.
  const backendTsFiles = listBackendSrcTsFiles()
  refuseEmptyScan('migrations', backendTsFiles.length, 'backend/src .ts files', ROOT)
  for (const absPath of backendTsFiles) {
    const relPath = path.relative(ROOT, absPath)
    /** @type {string} */
    let text
    try {
      text = readFileSync(absPath, 'utf8')
    } catch (err) {
      // Defensive, not the fix for any particular race: this check walks a LIVE working
      // tree (`listBackendSrcTsFiles()` above is a snapshot, not a lock), and any tool that
      // does that should not crash just because a file it saw a moment ago is gone by the
      // time it gets read -- a deleted branch switch mid-run, an editor's atomic-save
      // rename, anything. A file that no longer exists cannot violate `synchronize: false`,
      // so this is a silent skip, not a finding; any other read failure (permissions, etc.)
      // is still a real finding. (This layer's own test suite runs its check-test FILES
      // serially -- see the root `test:verify` script's `--test-concurrency=1` -- precisely
      // so that two tests mutating the same shared tree can never race each other; this
      // guard is not standing in for that.)
      const code = /** @type {{ code?: string }} */ (err).code
      if (code === 'ENOENT') continue
      findings.push(`${relPath}: unreadable: ${errMessage(err)}`)
      continue
    }
    const sourceFile = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const hit of findSynchronizeFindings(sourceFile)) {
      findings.push(
        `${relPath}:${hit.line}: synchronize is '${hit.text}', not the literal false -- ` +
          'TypeORM must never be allowed to synchronize schema from entities; every schema ' +
          'change goes through a migration.',
      )
    }
  }

  // Rules 2 & 3: filenames, ordering, and exported class names in backend/src/migrations/.
  /** @type {import('node:fs').Dirent[]} */
  let entries
  try {
    entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  } catch (err) {
    throw new Error(`migrations: could not read ${MIGRATIONS_REL}: ${errMessage(err)}`)
  }
  // INTERSECTED WITH GIT'S VIEW, because the two halves of this check disagreed about what
  // "a file in this repo" means: rule 1 enumerates with `git ls-files --exclude-standard`,
  // rules 2/3 with readdirSync. A gitignored `.DS_Store` in this directory is invisible to
  // the first and a FINDING to the second — so opening backend/src/migrations/ in Finder
  // turned the fast tier red. Same for *.orig, *.rej and editor swap files.
  //
  // Narrowing note: a stray file that is ALSO gitignored is no longer flagged. That is the
  // right trade — git's ignore list is the repo's own statement about what is not part of
  // it, and this check has no business overruling it.
  const tracked = new Set(
    listBackendSrcFiles()
      .filter((abs) => path.dirname(abs) === MIGRATIONS_DIR)
      .map((abs) => path.basename(abs)),
  )
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => tracked.has(name))
    .sort()

  /** @type {Candidate[]} */
  const candidates = []
  for (const file of files) {
    if (DB_SPEC_RE.test(file)) continue // a Jest suite living alongside the migrations, not one
    const m = MIGRATION_FILENAME_RE.exec(file)
    if (!m) {
      findings.push(
        `${MIGRATIONS_REL}/${file}: filename does not match /^(\\d{13})-([A-Za-z0-9]+)\\.ts$/ ` +
          'and is not a *.db-spec.ts file -- backend/src/migrations/ holds only migrations ' +
          'and their db-spec suites; nothing else belongs here.',
      )
      continue
    }
    candidates.push({ file, timestamp: m[1], name: m[2] })
  }

  // Rule 2: no two migrations may share a timestamp. Filenames are a fixed-width 13-digit
  // prefix, so alphabetical order and numeric-timestamp order coincide exactly -- once
  // duplicates are ruled out, "strictly ascending" is automatic, not a separate check.
  /** @type {Map<string, string[]>} */
  const byTimestamp = new Map()
  for (const c of candidates) {
    const bucket = byTimestamp.get(c.timestamp) ?? []
    bucket.push(c.file)
    byTimestamp.set(c.timestamp, bucket)
  }
  for (const [timestamp, filesForTimestamp] of byTimestamp) {
    if (filesForTimestamp.length > 1) {
      findings.push(
        `${MIGRATIONS_REL}: duplicate timestamp ${timestamp} shared by ${filesForTimestamp
          .sort()
          .join(', ')} -- migration timestamps must be unique and strictly ascending.`,
      )
    }
  }

  // Rule 3: exported class name must be name+timestamp.
  for (const c of candidates) {
    const absPath = path.join(MIGRATIONS_DIR, c.file)
    const relPath = path.join(MIGRATIONS_REL, c.file)
    /** @type {string} */
    let text
    try {
      text = readFileSync(absPath, 'utf8')
    } catch (err) {
      // Same defensive reasoning as rule 1 above -- see that comment.
      const code = /** @type {{ code?: string }} */ (err).code
      if (code === 'ENOENT') continue
      findings.push(`${relPath}: unreadable: ${errMessage(err)}`)
      continue
    }
    const sourceFile = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const expected = expectedClassName(c.name, c.timestamp)
    const exported = findExportedClassNames(sourceFile)
    if (!exported.includes(expected)) {
      const found = exported.length ? exported.map((n) => `'${n}'`).join(', ') : 'no exported class'
      findings.push(
        `${relPath}: expected an exported class named '${expected}' ` +
          `(filename name '${c.name}' + timestamp '${c.timestamp}'), found ${found}.`,
      )
    }
  }

  // Rule 4: already-merged migrations are frozen.
  if (!originMainIsResolvable()) {
    warnings.push(
      'WARNING: origin/main is not a resolvable ref (not fetched, or no such remote) -- ' +
        'rule 4 (already-merged migrations must be byte-identical to origin/main) was ' +
        'SKIPPED for this run. This proves nothing about whether a merged migration was ' +
        'edited; fetch origin/main and re-run to restore that guarantee.',
    )
  } else {
    // 4a -- the CONTENT of what is on disk.
    for (const c of candidates) {
      const relPath = path.join(MIGRATIONS_REL, c.file)
      // git wants a forward-slash path regardless of OS; MIGRATIONS_REL/path.join above
      // already come out forward-slash on POSIX, which is the only platform this repo's
      // toolchain (Docker-based dev, Node engines) targets.
      if (!existsInOriginMain(relPath)) continue // new since origin/main -- nothing to compare
      if (!unchangedFromOriginMain(relPath)) {
        findings.push(
          `${relPath}: differs from its origin/main copy -- this migration already exists ` +
            'on origin/main and must be byte-identical there. Fix forward: write a new ' +
            'migration instead of editing this one.',
        )
      }
    }

    // 4b -- the EXISTENCE of what was merged. `candidates` above is built from the on-disk
    // directory, so a DELETED or RENAMED merged migration is invisible to 4a by
    // construction: the path is never enumerated, so it is never compared. `rm` one and
    // this check reported "intact". A rename is worse — the old path vanishes and the new
    // one has no origin/main counterpart, so `continue` swallows both halves and the run is
    // fully green.
    //
    // Keyed on the MERGE-BASE, not origin/main: see mergeBaseWithOriginMain.
    const base = mergeBaseWithOriginMain()
    if (!base) {
      warnings.push(
        'WARNING: origin/main resolves but has no merge-base with HEAD (a shallow clone, ' +
          'or unrelated histories) -- rule 4b (an already-merged migration must not be ' +
          'deleted or renamed) was SKIPPED for this run. Rules 1-3 and 4a still applied. ' +
          'Fetch full history and re-run to restore that guarantee.',
      )
    } else {
      const byTimestampOnDisk = new Map(candidates.map((c) => [c.timestamp, c.file]))
      const onDisk = new Set(candidates.map((c) => c.file))
      for (const rel of migrationsAtRef(base)) {
        const file = path.basename(rel)
        if (onDisk.has(file)) continue
        const m = MIGRATION_FILENAME_RE.exec(file)
        const renamedTo = m ? byTimestampOnDisk.get(m[1]) : undefined
        findings.push(
          `${rel}: was already merged (present at ${base.slice(0, 12)}, the merge-base with ` +
            'origin/main) and is GONE from the working tree' +
            (renamedTo ? ` -- it appears to have been RENAMED to ${renamedTo}.` : '.') +
            ' TypeORM records a migration by CLASS NAME in the `migrations` table of every ' +
            'database that ran it, so deleting or renaming the file makes migration:revert ' +
            'impossible and lets a fresh database diverge from every existing one. Fix ' +
            'forward: restore the file and write a NEW migration.',
        )
      }
    }
  }

  return { findings, warnings }
}

function main() {
  /** @type {{ findings: string[], warnings: string[] }} */
  let result
  try {
    result = scan()
  } catch (err) {
    process.stderr.write(`migrations: RED\n  ${errMessage(err)}\n`)
    process.exit(1)
    return
  }

  for (const w of result.warnings) process.stdout.write(`${w}\n`)

  if (result.findings.length > 0) {
    process.stderr.write('migrations: RED\n')
    for (const f of result.findings) process.stderr.write(`  ${f}\n`)
    process.exit(1)
  }

  process.stdout.write(
    'migrations: intact -- synchronize is false everywhere in backend/src, every migration ' +
      'filename/timestamp/class name is well-formed, and every already-merged migration this ' +
      'run could check against origin/main is unchanged\n',
  )
}

main()
