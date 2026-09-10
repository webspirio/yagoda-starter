#!/usr/bin/env node
/**
 * The identity seam: `user_identities(provider, provider_user_id)` is meant to be the
 * SINGLE login lookup path (root CLAUDE.md, "Identity seam"). Today that is prose in a
 * memo — nothing mechanical stops a second login path from growing behind it. This check
 * is the mechanism, over every `backend/src/**\/*.ts` file, as two rules:
 *
 *  1. Provider literal. A bare string literal `'local'` is a finding UNLESS the file is
 *     under `migrations/` (a migration is frozen by definition — see backend/CLAUDE.md's
 *     "fix forward, don't edit history"), under `seed/` (the dev-only demo-data script,
 *     never a runtime dependency of the app it seeds), is a `*.spec.ts` / `*.db-spec.ts`
 *     (test code, not application behaviour), or is `users/user-identity.entity.ts`
 *     itself — the one file that DECLARES `LOCAL_PROVIDER`. A second hardcoded `'local'`
 *     anywhere else in application code is a second, undeclared login path forming
 *     behind the constant's back, exactly what an OAuth provider addition is supposed to
 *     replace by writing a *different* value, not by leaving this one lying around too.
 *  2. Seed isolation. Any import / require / re-export whose specifier resolves inside
 *     `backend/src/seed/` is a finding unless the importing file is itself under `seed/`
 *     or is a spec. The seed is a standalone CLI script
 *     (`backend/src/seed/dev-seed.cli.ts`, run via `npm run seed:dev`) — nothing in the
 *     application it seeds is meant to import it back.
 *
 * PARSED WITH THE TYPESCRIPT COMPILER API (`ts.createSourceFile`), not a regex, so this
 * is immune to the two ways a regex gets this wrong: a *comment* that merely mentions
 * "local" is not a finding (rule 1 only counts a `Literal` node — `ts.isStringLiteralLike`
 * — whose `.text` is EXACTLY `"local"`, so a `-----` no substring match survives inside a
 * longer string, e.g. the SQL literals in `seed/dev-seed.ts` that spell out
 * `WHERE provider = 'local'` as part of a much longer query string), and a *bare package
 * specifier* is never mistaken for a relative path (rule 2 only resolves a specifier that
 * starts with `./` or `../` — see `resolvesIntoSeedDir` below).
 *
 * Specifier forms rule 2 resolves: a relative `import`/`export … from '...'`, an
 * `import x = require('...')`, a `require('...')` call, and a dynamic `import('...')`
 * call — in every case, only when the specifier is a plain string literal (nothing here
 * evaluates code, so `require(computedPath)` is invisible to it) AND the specifier itself
 * is relative (`./` or `../`). A bare package specifier (`'typeorm'`, `'@nestjs/common'`)
 * is never resolved as a local path — this repo declares no `tsconfig` `paths` aliases
 * (confirmed against `backend/tsconfig.json`), so nothing else could resolve into
 * `backend/src` at all, and treating an ordinary package import as a candidate path would
 * be a false positive on nearly every file in the tree. An absolute specifier (starting
 * with `/`) is likewise never resolved — this repository does not use one anywhere in
 * `backend/src`, and inventing a rule for a shape that doesn't occur here would be
 * speculative generality this check does not need.
 *
 * Type-only imports count too (`import type { X } from '../seed/dev-seed'`): the seam
 * this check defends is about what backend/src's SOURCE TREE admits depending on, not
 * about what survives to compiled JS — a type-only import is still a declared, visible
 * dependency on the seed in source.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { errMessage } from '../hash.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const BACKEND_SRC = path.join(ROOT, 'backend', 'src')
const SEED_DIR = path.join(BACKEND_SRC, 'seed')
const DECLARING_FILE = path.join(BACKEND_SRC, 'users', 'user-identity.entity.ts')

/** The one value rule 1 defends. `LOCAL_PROVIDER`'s own value — kept as one named constant
 * here rather than repeated as a literal below, so the thing this check hunts for and the
 * string it prints in its own findings can never drift apart from each other. */
const PROVIDER_VALUE = 'local'

/**
 * @param {string} relFromBackendSrc posix-or-OS-separated path relative to backend/src
 * @returns {boolean}
 */
function isUnderMigrations(relFromBackendSrc) {
  return relFromBackendSrc === 'migrations' || relFromBackendSrc.startsWith(`migrations${path.sep}`)
}

/** @param {string} relFromBackendSrc @returns {boolean} */
function isUnderSeed(relFromBackendSrc) {
  return relFromBackendSrc === 'seed' || relFromBackendSrc.startsWith(`seed${path.sep}`)
}

/** @param {string} absPath @returns {boolean} */
function isSpecFile(absPath) {
  return /\.(spec|db-spec)\.ts$/.test(absPath)
}

/**
 * Every `.ts` file under `backend/src`, tracked or untracked-but-not-ignored — the same
 * `-c -o --exclude-standard` combination `scripts/verify/hash.mjs` uses, and for the same
 * reason: a freshly written fixture file that has not been `git add`ed yet must still be
 * seen, or a red-case test that merely writes a new file (never staging it) would report
 * a false green.
 *
 * @returns {string[]} absolute paths, sorted
 */
function listBackendSrcTsFiles() {
  const NUL = String.fromCharCode(0)
  /** @type {Buffer} */
  let raw
  try {
    raw = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z', '--', 'backend/src'], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (err) {
    throw new Error(`seam: git could not enumerate backend/src files: ${errMessage(err)}`)
  }
  return raw
    .toString('utf8')
    .split(NUL)
    .filter((rel) => rel.endsWith('.ts'))
    .map((rel) => path.join(ROOT, rel))
    .sort()
}

/**
 * Rule 1: every `Literal` node (`ts.isStringLiteralLike` — a quoted string or a
 * backtick string with no `${...}` substitution; a template literal WITH a substitution
 * is split into `TemplateHead`/`TemplateMiddle`/`TemplateTail` pieces, none of which this
 * matches, so an interpolated SQL string built around `'local'` is never a candidate at
 * all) whose text is exactly `"local"`.
 *
 * @param {ts.SourceFile} sourceFile
 * @returns {{ line: number }[]}
 */
function findProviderLiterals(sourceFile) {
  /** @type {{ line: number }[]} */
  const hits = []
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isStringLiteralLike(node) && node.text === PROVIDER_VALUE) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      hits.push({ line: line + 1 })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return hits
}

/**
 * Every import-like specifier string literal in a file: static `import`/`export … from`,
 * `import x = require(...)`, a `require(...)` call, and a dynamic `import(...)` call. See
 * the file header for exactly which forms this does and does not cover.
 *
 * @param {ts.SourceFile} sourceFile
 * @returns {{ specifier: string, line: number }[]}
 */
function findImportSpecifiers(sourceFile) {
  /** @type {{ specifier: string, line: number }[]} */
  const out = []
  /** @param {ts.StringLiteralLike} node */
  function record(node) {
    out.push({
      specifier: node.text,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    })
  }
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      record(node.moduleSpecifier)
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      record(node.moduleSpecifier)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      record(node.moduleReference.expression)
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      const isRequireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      if (isRequireCall || isDynamicImport) record(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return out
}

/**
 * Rule 2's resolution step. Only a RELATIVE specifier (`./` or `../`) is even a
 * candidate — see the file header for why a bare package specifier is deliberately never
 * resolved. Resolved against the IMPORTING FILE's own directory (not `backend/src`, not
 * the repo root), then normalised so `../seed/../seed/dev-seed` and `../seed/dev-seed`
 * compare equal.
 *
 * @param {string} specifier
 * @param {string} importingFileAbsPath
 * @returns {boolean}
 */
function resolvesIntoSeedDir(specifier, importingFileAbsPath) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false
  const resolved = path.normalize(path.resolve(path.dirname(importingFileAbsPath), specifier))
  return resolved === SEED_DIR || resolved.startsWith(`${SEED_DIR}${path.sep}`)
}

/**
 * @returns {string[]} findings, empty when the seam is intact
 */
function scan() {
  /** @type {string[]} */
  const findings = []

  for (const absPath of listBackendSrcTsFiles()) {
    const relFromBackendSrc = path.relative(BACKEND_SRC, absPath)
    const relFromRoot = path.relative(ROOT, absPath)
    const migrations = isUnderMigrations(relFromBackendSrc)
    const seed = isUnderSeed(relFromBackendSrc)
    const spec = isSpecFile(absPath)
    const isDeclaringFile = absPath === DECLARING_FILE

    /** @type {string} */
    let text
    try {
      text = readFileSync(absPath, 'utf8')
    } catch (err) {
      // ENOENT here is not a finding: this verify layer's own tests write and remove
      // short-lived fixture files under backend/src while their OWN check runs, and
      // `node --test` runs different *.test.mjs files concurrently -- so a file this git
      // listing saw a moment ago (e.g. another check's migrations/ fixture, exercised
      // concurrently by migration-invariants.test.mjs) can legitimately be gone by the
      // time it is read here. A file that no longer exists cannot carry a provider literal
      // or a seed import; any other read failure (permissions, etc.) is still a finding.
      const code = /** @type {{ code?: string }} */ (err).code
      if (code === 'ENOENT') continue
      findings.push(`${relFromRoot}: unreadable: ${errMessage(err)}`)
      continue
    }

    const sourceFile = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

    // Rule 1: the provider literal.
    if (!migrations && !seed && !spec && !isDeclaringFile) {
      for (const hit of findProviderLiterals(sourceFile)) {
        findings.push(
          `${relFromRoot}:${hit.line}: string literal 'local' — the login provider value is ` +
            'declared exactly once, as LOCAL_PROVIDER in backend/src/users/user-identity.entity.ts; ' +
            'import that constant instead of re-typing the literal here, or this file grows into a ' +
            'second, undeclared login path.',
        )
      }
    }

    // Rule 2: seed isolation.
    if (!seed && !spec) {
      for (const imp of findImportSpecifiers(sourceFile)) {
        if (resolvesIntoSeedDir(imp.specifier, absPath)) {
          findings.push(
            `${relFromRoot}:${imp.line}: imports '${imp.specifier}', which resolves inside ` +
              'backend/src/seed/ — the seed is a standalone CLI script ' +
              '(backend/src/seed/dev-seed.cli.ts, run via `npm run seed:dev`), never a runtime ' +
              'dependency of the application it seeds.',
          )
        }
      }
    }
  }

  return findings
}

function main() {
  /** @type {string[]} */
  let findings
  try {
    findings = scan()
  } catch (err) {
    process.stderr.write(`seam: RED\n  ${errMessage(err)}\n`)
    process.exit(1)
    return
  }

  if (findings.length > 0) {
    process.stderr.write('seam: RED\n')
    for (const f of findings) process.stderr.write(`  ${f}\n`)
    process.exit(1)
  }

  process.stdout.write(
    'seam: intact — no backend/src file outside migrations/, seed/ and specs re-types the ' +
      "'local' provider literal, and no backend/src file outside seed/ and specs imports the seed\n",
  )
}

main()
