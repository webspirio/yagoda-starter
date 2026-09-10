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

/** Directory prefixes whose contents feed at least one check. */
const HASHED_PREFIXES = [
  'backend/',
  'frontend/',
  'nginx/',
  'scripts/',
  '.claude/',
  '.github/workflows/',
]

/**
 * Exact paths outside those directories.
 *
 * CLAUDE.md is here because it is the ENTIRE INPUT to the `memo` check. Leaving it out
 * means a hand-edited table does not change the hash, `--reuse-if-fresh` serves a cached
 * green, and the one check whose whole job is catching that drift can never run.
 *
 * .gitignore is here because the `secrets` check's whole subject is which lines of it keep
 * .env out of the repository. A change to that boundary must never be cache-invisible.
 *
 * The compose files and .dockerignore are here because `docker` and `smoke` build from them.
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
  'CLAUDE.md',
])

/**
 * A NUL byte cannot occur in a POSIX path, so it is the only safe field delimiter.
 * A newline or a colon would let a crafted filename forge a different file list that
 * hashes the same.
 */
const NUL = Buffer.from([0])

/**
 * @param {string} rel
 * @returns {boolean}
 */
function isHashed(rel) {
  if (HASHED_EXACT.has(rel)) return true
  if (/^tsconfig[^/]*\.json$/.test(rel)) return true
  return HASHED_PREFIXES.some((prefix) => rel.startsWith(prefix))
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
