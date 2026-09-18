/**
 * Content-addressed identity of everything that can change what a check concludes.
 *
 * Never mtime, and never "is the working tree dirty" — a turn that commits its work
 * leaves a clean tree and would earn a free green.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Directory prefixes whose contents feed at least one check.
 *
 * `e2e/` is here for `typecheck`, not only for `smoke`: tsconfig.e2e.json includes
 * `e2e/**` and `playwright.config.ts`, and package.json's typecheck script ends
 * `&& tsc -p tsconfig.e2e.json` — a FAST-tier row. A type error in e2e/ used to leave the
 * digest unchanged, so `--reuse-if-fresh` replayed a green over a red tree.
 *
 * `.githooks/` is here because run.test.mjs reads .githooks/pre-push as a test input and
 * asserts its `--exclude` list matches package.json's. Editing the hook without hashing it
 * is the same false green on the gate's own path.
 */
const HASHED_PREFIXES = [
  'backend/',
  'frontend/',
  'nginx/',
  'scripts/',
  '.claude/',
  '.github/workflows/',
  '.githooks/',
  'e2e/',
]

/**
 * Exact paths outside those directories.
 *
 * EVERY ENTRY HERE IS A FILE SOME CHECK READS. That is the only admission criterion, and
 * the inverse — a file a check reads that is NOT in the surface — is a false green: the
 * digest does not move, `--reuse-if-fresh` replays the stored verdict, and the check that
 * would have caught the change never runs. `.env.example` and `knip.json` were both
 * missing, and both were reproduced end to end as replayed greens over red checks.
 *
 * .gitignore and .env.example are `secrets`' inputs; .env.example is what rule 4 scans for
 * a real value in a placeholder file. knip.json is `deadcode`'s entire exemption surface.
 * 28-db-schema.dbml is the schema of record and the input to the `schema` conformance row.
 * The compose files and .dockerignore are here because `smoke` builds from them.
 *
 * `CLAUDE.md` is deliberately NOT justified as "the memo check's input" any more — memo
 * reads .claude/skills/verify/SKILL.md (memo-drift.mjs), and has since 2026-09-16. It stays
 * only until the row set is final and the surface is derived from the registry.
 */
const HASHED_EXACT = new Set([
  'package.json',
  'package-lock.json',
  'turbo.json',
  'docker-compose.yml',
  'docker-compose.prod.yml',
  '.dockerignore',
  '.nvmrc',
  '.gitignore',
  '.env.example',
  'knip.json',
  '28-db-schema.dbml',
  'CLAUDE.md',
])

/**
 * Path-shaped inputs no exact name can enumerate.
 *
 * The knip alternative-basenames pattern exists because `deadcode` treats the mere
 * EXISTENCE of a second root config as a finding — so creating `knip.ts` changes that
 * check's verdict while changing no file the surface would otherwise see.
 */
const HASHED_MATCH = [
  /^tsconfig[^/]*\.json$/,
  /^playwright\.config\.[cm]?[jt]s$/,
  /^\.?knip\.(json|jsonc|ts|js|mjs|cjs)$/,
]

/**
 * A NUL byte cannot occur in a POSIX path, so it is the only safe field delimiter.
 * A newline or a colon would let a crafted filename forge a different file list that
 * hashes the same.
 */
const NUL = Buffer.from([0])

/**
 * Is this repo-relative path inside the freshness surface?
 *
 * Exported because the only honest test of the surface is one that asks it directly about
 * a path a check declares it reads. hash.test.mjs asserts BOTH directions: a file outside
 * does not move the digest, and every declared input does.
 *
 * @param {string} rel
 * @returns {boolean}
 */
export function isHashed(rel) {
  if (HASHED_EXACT.has(rel)) return true
  if (HASHED_MATCH.some((re) => re.test(rel))) return true
  return HASHED_PREFIXES.some((prefix) => rel.startsWith(prefix))
}

/**
 * The environment for a child `git`, with every GIT_* variable removed.
 *
 * `cwd` DOES NOT WIN OVER `GIT_DIR`. With that variable set, git ignores the working
 * directory entirely and operates on the repository it names — so `sourceHash(root)` would
 * silently hash a DIFFERENT repository than the one its own argument asks for. Git exports
 * GIT_DIR (and GIT_INDEX_FILE) into every hook it runs, and .githooks/pre-push runs this
 * layer, so the variable is present on exactly the path a local gate takes.
 *
 * Learned on 2026-09-15, expensively: the same inheritance let hash.test.mjs's fixture
 * commit into the real repository, replacing its tree with three fixture files. The hook
 * scrubs these as well; this is the lock that makes the function honour its own parameter
 * no matter who calls it.
 *
 * @returns {NodeJS.ProcessEnv}
 */
function gitEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function errMessage(err) {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Tracked files plus untracked-but-not-ignored files. `-o --exclude-standard` is what
 * pulls in a brand-new test or ratchet that has not been committed yet: without it a
 * freshly written failing test would not change the hash, and a stale green would be
 * served over it.
 *
 * @param {string} root
 * @returns {string[]}
 */
function listHashedFiles(root) {
  let raw
  try {
    raw = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
      cwd: root,
      env: gitEnv(),
      maxBuffer: 128 * 1024 * 1024,
    })
  } catch (err) {
    throw new Error(`sourceHash: git could not enumerate files: ${errMessage(err)}`)
  }
  // `-c` and `-o` can both name the same path in some states; dedupe before hashing so
  // the digest depends on the set of files, not on git's listing order.
  const seen = new Set(
    raw.toString('utf8').split('\u0000').filter(Boolean).filter(isHashed),
  )
  return [...seen].sort()
}

/**
 * @param {string} root
 * @returns {{ hash: string, fileCount: number }}
 */
export function sourceHash(root) {
  const files = listHashedFiles(root)
  const outer = createHash('sha256')
  for (const rel of files) {
    outer.update(rel, 'utf8')
    outer.update(NUL)
    let digest = 'ABSENT'
    try {
      digest = createHash('sha256').update(readFileSync(path.join(root, rel))).digest('hex')
    } catch {
      // Tracked but removed from the worktree. Recorded as ABSENT rather than skipped,
      // so a deletion is a visible field change and not an invisible shorter list.
    }
    outer.update(digest, 'utf8')
    outer.update(NUL)
  }
  return { hash: outer.digest('hex'), fileCount: files.length }
}

// Diagnostic entry point: `node scripts/verify/hash.mjs` prints exactly which files
// feed the freshness decision. Without this the hash is an opaque number and "why was
// my green reused?" has no answer.
if (process.argv[1] && process.argv[1].endsWith('hash.mjs')) {
  // `node scripts/verify/hash.mjs | head -1` closes the pipe early; without this the
  // diagnostic dies with an unhandled EPIPE and a stack trace.
  process.stdout.on('error', () => process.exit(0))
  const root = process.cwd()
  const { hash, fileCount } = sourceHash(root)
  process.stdout.write(`sourceHash ${hash}\n${fileCount} files:\n`)
  for (const f of listHashedFiles(root)) process.stdout.write(`  ${f}\n`)
}
