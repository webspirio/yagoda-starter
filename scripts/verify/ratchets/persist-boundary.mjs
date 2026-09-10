#!/usr/bin/env node
/**
 * The four frontend localStorage boundaries must stay guarded, narrowed, and default-deny.
 *
 * GROUND, verified 2026-09-10 (see spec §4.3): `frontend/src` has FOUR independent boundaries
 * that read or write `localStorage` — none of them zustand `persist` — plus a fifth file this
 * task's own re-read of the tree turned up that the spec's table does not name:
 *
 *   - entities/user/model/store.ts          the bearer token (opaque string)
 *   - shared/api/persister.ts               the TanStack query cache (default-deny allowlist)
 *   - shared/lib/form-draft/draftStorage.ts raw form-draft blobs (envelope owned elsewhere)
 *   - shared/lib/i18n/language-preference.ts the language code (narrowed to SUPPORTED_LANGUAGES)
 *   - shared/lib/theme/theme-preference.ts   the theme preference — NOT in the spec's table,
 *     found by this task's own grep, already narrowed the identical way language-preference.ts
 *     is (a local `x is T` predicate). Nothing here special-cases it: it is simply one more
 *     file this scan reaches under `frontend/src/**`, and it is reported honestly rather than
 *     folded silently into "four".
 *
 * Every one of the five already does the right thing. This ratchet enforces three rules so a
 * later edit cannot regress any of them without this exact command turning red.
 *
 * RULE 1 — every `localStorage`/`sessionStorage` access sits inside a `try`/`catch`. The
 * accessor itself throws in some private-browsing modes, and this module graph is imported at
 * bootstrap (`main.tsx` -> `shared/api`), so an unguarded throw is a blank page, not a
 * degraded feature. "Access" here means a property/element access made ON the storage object
 * ITSELF — `localStorage.getItem`, `sessionStorage.setItem`, `window.localStorage.removeItem`
 * — found by walking every node's AST-parent chain for a `TryStatement` whose `tryBlock`
 * contains it.
 *
 * DELIBERATE SCOPE DECISION, load-bearing for the real tree staying green: a BARE two-level
 * reference to the storage global — `window.localStorage` with nothing chained onto it — is
 * NOT itself a target of rule 1. Only a further member/element access ON that reference is
 * ("localStorage.getItem", "window.localStorage.getItem"). This is not a loophole; it is what
 * makes `persister.ts`'s own `safeStorage(read: () => Storage)` correct: that file's header
 * comment says outright that `read` is "a thunk rather than a `Storage` so the getter access
 * itself happens inside the try" — `safeStorage`'s try wraps `read()`, and the thunk's body
 * (`() => window.localStorage`) is a value handed to `safeStorage`, not a member access on it.
 * A rule that flagged the bare reference would be WRONG about this file, per this task's own
 * brief ("if your check flags one of them, your check is wrong, not the file"). The trade-off,
 * stated once here rather than buried in blindSpot prose meant for the registry: a storage
 * object obtained through an intermediate variable (`const s = window.localStorage; s.getItem(...)`)
 * is invisible to rule 1 too, on the same reasoning that keeps `safeStorage`'s own
 * `storage.setItem`/`storage.removeItem` (called on its local `storage`, not on the global
 * name) out of scope. Rule 1 only ever recognises the storage object BY NAME.
 *
 * RULE 2 — every value read back out via `getItem` reaches app state only through a runtime
 * narrowing: `typeof`, `Array.isArray`, `in`, `instanceof`, a `.parse(` call, or a local
 * type-predicate function (`x is T`) DECLARED IN THE SAME FILE. A predicate imported from
 * elsewhere cannot be confirmed from the AST and does not count (see blindSpot in the
 * registry entry).
 *
 * For each `getItem` call found under rule 1's object-naming rule, this file classifies its
 * immediate use, unwrapping `(...)`, `!` and `as`/`<T>` casts first (a cast is recorded but
 * never itself accepted as a narrowing — the whole point of a cast is that it side-steps a
 * runtime check):
 *
 *   - returned bare, with no cast (`return localStorage.getItem(x)`, directly or via a
 *     `const v = ...; return v;` alias with nothing else done to `v`): treated as an OPAQUE
 *     PASSTHROUGH and exempt. This is real, not a hole poked to fit a file: `readStoredToken()`
 *     and `loadLocal()` both return the value as-is, used everywhere downstream as the
 *     `string | null` it already is — there is no narrower shape being claimed, so there is
 *     nothing to prove at runtime. `getStoredLanguage()`/`getStored()` (theme) are NOT this
 *     case: each declares a narrower return type (`SupportedLanguage | null` /
 *     `ThemePreference`) and each supplies a same-file `x is T` predicate before returning.
 *   - assigned to a local (`const v = ...getItem(...)`) and NEVER cast: exempt UNLESS (a) the
 *     variable is later used structurally (property/element access, or passed to
 *     `Number`/`parseInt`/`parseFloat`), or (b) the ENCLOSING FUNCTION'S OWN declared return
 *     type is narrower than the raw `string | null` `getItem` actually returns — with no
 *     narrowing found anywhere in the function for either case. (b) is what makes an imported,
 *     unconfirmable predicate a finding rather than a free pass: a function typed to return
 *     `SupportedLanguage` is CLAIMING a narrower shape, and nothing in this file backs that
 *     claim up if the only thing establishing it lives in a file this scan cannot see.
 *   - cast at all (`as T`, `<T>expr`) with no accepted narrowing construct also present in the
 *     function: always a finding. A cast makes the compiler agree without asking the runtime.
 *
 * RULE 3 — `isPersistableKey`'s allowlist. Ground: `shared/api/persister.ts` declares
 * `export function isPersistableKey(queryKey) { const [head] = queryKey; return head === 'me'; }`
 * — a default-deny gate for what may be written to `localStorage` at all. This scan looks for
 * ANY function or arrow/function-expression-initialised variable named exactly
 * `isPersistableKey`, anywhere under `frontend/src` (not hard-coded to one path, the same
 * stance `seam-boundary.mjs` takes toward `LOCAL_PROVIDER`), and collects every string literal
 * that function's body compares the key against (`===`/`!==`/`==`/`!=`, a `case` label, or an
 * array literal's `.includes(...)` argument). That set must equal
 * `scripts/verify/baselines/persist-boundary.json`'s `entries[].key`, in BOTH directions —
 * exactly the discipline `ratchet:lint-exempt` and `ratchet:money` already apply elsewhere:
 * new is red, and an entry with no matching literal left in the tree is red too, so a removed
 * key does not sit forgiven forever. NO `--write` MODE, on purpose, same reasoning as
 * `lint-exempt.mjs`: adding a persisted query key is meant to be a reviewed, hand-written
 * addition to this file, not an auto-filled rubber stamp.
 *
 * PARSED WITH THE TYPESCRIPT COMPILER API, never a regex, and with the SCRIPT KIND MATCHED TO
 * THE EXTENSION (`ts.ScriptKind.TSX` for `.tsx`, `ts.ScriptKind.TS` for `.ts`) — a `.tsx` file
 * parsed as plain `.ts` silently mis-parses JSX syntax and under-reports.
 *
 * SCOPE EXCLUSION, found while proving rule 1 red/green, not assumed up front:
 * `frontend/src/test-setup.ts` (vitest's global setup file, wired by `vite.config.ts`'s
 * `test.setupFiles` and imported by nothing else — confirmed by grep) calls
 * `localStorage.clear()`/`sessionStorage.clear()` unguarded in an `afterEach`. This is real
 * source rule 1's naive scan does reach, and it is genuinely unguarded — but it is not a
 * production runtime boundary: it never ships in the built bundle, and it runs only under
 * jsdom, whose `Storage.clear()` does not exhibit the private-browsing throw this rule exists
 * to guard against. Excluding it by exact path is the same class of decision
 * money-rounding.mjs makes excluding `*.spec.ts`/`*.db-spec.ts` from a rule about production
 * arithmetic: a stated, file-role-based SCOPE boundary, not a baseline entry forgiving a
 * violation in one of the four real boundary files (none of which this exclusion touches).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { errMessage } from '../hash.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const BASELINE_REL = 'scripts/verify/baselines/persist-boundary.json'
const BASELINE_PATH = path.join(ROOT, BASELINE_REL)
const FRONTEND_SRC = 'frontend/src'

/**
 * `frontend/src/test-setup.ts` — vitest's global setup file (`vite.config.ts`'s
 * `test.setupFiles`), imported by nothing else, never part of the production bundle. See the
 * file header's "SCOPE EXCLUSION" note for why it is out of rule 1's territory.
 */
const EXCLUDED_FILES = new Set(['frontend/src/test-setup.ts'])

const MIN_REASON_LENGTH = 30

/**
 * @typedef {object} AccessFinding
 * @property {string} file repo-root-relative, forward-slash separated
 * @property {number} line 1-based
 * @property {string} text normalised source text
 */

/**
 * @typedef {object} NarrowingFinding
 * @property {string} file
 * @property {number} line
 * @property {string} text
 * @property {string} reason why this getItem read is a violation
 */

/**
 * Every `.ts`/`.tsx` file under `frontend/src`, tracked or untracked-but-not-ignored (so a
 * freshly written, never-`git add`-ed fixture is still seen), excluding `*.test.*` — the same
 * `-c -o --exclude-standard` combination the other ratchets in this layer use, for the same
 * reason: a red-case test that only writes a file must not report a false green.
 *
 * @returns {string[]} repo-root-relative paths, forward-slash separated, sorted
 */
function listCandidateFiles() {
  const NUL = String.fromCharCode(0)
  /** @type {Buffer} */
  let raw
  try {
    raw = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z', '--', FRONTEND_SRC], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (err) {
    throw new Error(`persist-boundary: git could not enumerate ${FRONTEND_SRC}: ${errMessage(err)}`)
  }
  return raw
    .toString('utf8')
    .split(NUL)
    .filter(Boolean)
    .filter((rel) => rel.endsWith('.ts') || rel.endsWith('.tsx'))
    .filter((rel) => !rel.includes('.test.'))
    .filter((rel) => !EXCLUDED_FILES.has(rel))
    .sort()
}

/** @param {string} rel @returns {ts.ScriptKind} */
function scriptKindFor(rel) {
  return rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

/**
 * @param {string} rel
 * @returns {ts.SourceFile | null} null when the file vanished between listing and reading —
 *   a race against a live working tree, not a finding (same stance as money-rounding.mjs).
 */
function parseFile(rel) {
  const abs = path.join(ROOT, rel)
  /** @type {string} */
  let text
  try {
    text = readFileSync(abs, 'utf8')
  } catch (err) {
    const code = /** @type {{ code?: string }} */ (err).code
    if (code === 'ENOENT') return null
    throw new Error(`persist-boundary: ${rel} unreadable: ${errMessage(err)}`)
  }
  return ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, scriptKindFor(rel))
}

/** @param {string} s @returns {string} */
function normalise(s) {
  return s.replace(/\s+/g, ' ').trim()
}

/** @param {string} name @returns {boolean} */
function isStorageGlobalName(name) {
  return name === 'localStorage' || name === 'sessionStorage'
}

/**
 * True when `expr` names the storage object itself — `localStorage`/`sessionStorage`, or
 * `window.localStorage`/`window.sessionStorage` — never a variable merely holding one. See
 * the file header for why that is a deliberate boundary, not an oversight.
 *
 * @param {ts.Expression} expr
 * @returns {boolean}
 */
function isStorageObjectExpr(expr) {
  if (ts.isIdentifier(expr)) return isStorageGlobalName(expr.text)
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'window'
  ) {
    return isStorageGlobalName(expr.name.text)
  }
  return false
}

/**
 * Walks the AST-parent chain looking for a `TryStatement` whose `tryBlock` contains `node`.
 *
 * @param {ts.Node} node
 * @returns {boolean}
 */
function hasTryAncestor(node) {
  /** @type {ts.Node | undefined} */
  let current = node
  while (current) {
    /** @type {ts.Node | undefined} */
    const parent = current.parent
    if (parent && ts.isTryStatement(parent) && parent.tryBlock === current) return true
    current = parent
  }
  return false
}

/**
 * Every function/arrow/function-expression in `sf` whose declared return type is a TS type
 * predicate (`x is T`) — the only form rule 2 accepts as a "local type-predicate function",
 * and only when declared in the SAME file being scanned (this function never looks outside
 * `sf`, which is exactly what makes an imported predicate invisible to it).
 *
 * @param {ts.SourceFile} sf
 * @returns {Set<string>}
 */
function collectTypePredicateNames(sf) {
  /** @type {Set<string>} */
  const names = new Set()
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && node.type && ts.isTypePredicateNode(node.type)) {
      names.add(node.name.text)
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
      node.initializer.type &&
      ts.isTypePredicateNode(node.initializer.type)
    ) {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

/** @param {ts.Node} node @param {string} name @returns {boolean} */
function isIdentifierNamed(node, name) {
  return ts.isIdentifier(node) && node.text === name
}

/**
 * Does `scope` contain one of rule 2's accepted narrowing constructs applied to `varName`?
 * Shallow by design (see blindSpot: it proves the shape of the guard, not that the guard is
 * correct) — the FIRST occurrence found anywhere in `scope` is accepted, with no attempt to
 * verify it actually dominates every use of `varName`.
 *
 * @param {ts.Node} scope
 * @param {string} varName
 * @param {Set<string>} predicateNames
 * @returns {boolean}
 */
function isNarrowedWithin(scope, varName, predicateNames) {
  let found = false
  /** @param {ts.Node} node */
  function visit(node) {
    if (found) return
    if (ts.isTypeOfExpression(node) && isIdentifierNamed(node.expression, varName)) {
      found = true
      return
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      isIdentifierNamed(node.expression.expression, 'Array') &&
      node.expression.name.text === 'isArray' &&
      node.arguments.some((a) => isIdentifierNamed(a, varName))
    ) {
      found = true
      return
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
      isIdentifierNamed(node.left, varName)
    ) {
      found = true
      return
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InKeyword &&
      (isIdentifierNamed(node.left, varName) || isIdentifierNamed(node.right, varName))
    ) {
      found = true
      return
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'parse' &&
      node.arguments.some((a) => isIdentifierNamed(a, varName))
    ) {
      found = true
      return
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      predicateNames.has(node.expression.text) &&
      node.arguments.some((a) => isIdentifierNamed(a, varName))
    ) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(scope)
  return found
}

/**
 * Does `scope` use `varName` structurally — a property/element access on it, or pass it to
 * `Number`/`parseInt`/`parseFloat` — without that alone counting as narrowing? This is what
 * turns a merely-unchecked value into a FINDING rather than a tolerated opaque passthrough.
 *
 * @param {ts.Node} scope
 * @param {string} varName
 * @returns {boolean}
 */
function isUsedStructurally(scope, varName) {
  let found = false
  /** @param {ts.Node} node */
  function visit(node) {
    if (found) return
    if (ts.isPropertyAccessExpression(node) && isIdentifierNamed(node.expression, varName)) {
      found = true
      return
    }
    if (
      ts.isElementAccessExpression(node) &&
      (isIdentifierNamed(node.expression, varName) || isIdentifierNamed(node.argumentExpression, varName))
    ) {
      found = true
      return
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ['Number', 'parseInt', 'parseFloat'].includes(node.expression.text) &&
      node.arguments.some((a) => isIdentifierNamed(a, varName))
    ) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(scope)
  return found
}

/**
 * True when `typeNode` is exactly the shape `getItem` itself returns — `string`, `null`,
 * `undefined`, or a union of those — never a `TypeReference`, a string-literal union, or
 * anything else with a name of its own.
 *
 * @param {ts.TypeNode} typeNode
 * @returns {boolean}
 */
function isRawStorageStringTypeNode(typeNode) {
  if (
    typeNode.kind === ts.SyntaxKind.StringKeyword ||
    typeNode.kind === ts.SyntaxKind.NullKeyword ||
    typeNode.kind === ts.SyntaxKind.UndefinedKeyword
  ) {
    return true
  }
  if (ts.isLiteralTypeNode(typeNode) && typeNode.literal.kind === ts.SyntaxKind.NullKeyword) return true
  if (ts.isParenthesizedTypeNode(typeNode)) return isRawStorageStringTypeNode(typeNode.type)
  if (ts.isUnionTypeNode(typeNode)) return typeNode.types.every((t) => isRawStorageStringTypeNode(t))
  return false
}

/**
 * True when the nearest enclosing function-like node declares a return type OTHER than the
 * raw shape `getItem` actually returns (`string | null`) — i.e. the code CLAIMS a narrower
 * type than storage handed back, which rule 2 says may only be established by a runtime
 * narrowing, never silently assumed. This is what turns an imported (unconfirmable) predicate
 * into a finding instead of a tolerated opaque passthrough: the function's own signature says
 * a narrower type is being produced, and nothing rule 2 accepts backs that claim up.
 *
 * @param {ts.Node} callExpr
 * @returns {boolean}
 */
function enclosingFunctionClaimsNarrowerType(callExpr) {
  /** @type {ts.Node | undefined} */
  let current = callExpr.parent
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessor(current)
    ) {
      if (!current.type) return false
      return !isRawStorageStringTypeNode(current.type)
    }
    current = current.parent
  }
  return false
}

/**
 * @param {ts.Node} node
 * @returns {ts.Node} the nearest enclosing function-like body (or the node's source file if
 *   none exists — a top-level `getItem` call has module scope as its "function").
 */
function enclosingScope(node) {
  /** @type {ts.Node | undefined} */
  let current = node.parent
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessor(current) ||
      ts.isSetAccessor(current)
    ) {
      return current.body ?? current
    }
    current = current.parent
  }
  return node.getSourceFile()
}

/**
 * Classifies one `getItem(...)` call site per rule 2. Unwraps `(...)`, `!` and `as`/`<T>`
 * around the call first — a cast is recorded but never itself treated as narrowing.
 *
 * @param {ts.CallExpression} callExpr
 * @param {Set<string>} predicateNames
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function classifyReadSite(callExpr, predicateNames) {
  /** @type {ts.Node} */
  let valueNode = callExpr
  let hasCast = false
  for (;;) {
    const p = valueNode.parent
    if (!p) break
    if (ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p)) {
      valueNode = p
      continue
    }
    if (ts.isAsExpression(p) || ts.isTypeAssertionExpression(p)) {
      hasCast = true
      valueNode = p
      continue
    }
    break
  }
  const parent = valueNode.parent
  const scope = enclosingScope(callExpr)

  if (parent && ts.isReturnStatement(parent)) {
    if (!hasCast) return { ok: true }
    return {
      ok: false,
      reason:
        'the getItem() result is cast (`as`/`<T>`) directly into a return with no runtime ' +
        'narrowing anywhere in the function — a cast satisfies the compiler without ever ' +
        'checking the value at runtime',
    }
  }

  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    const varName = parent.name.text
    if (isNarrowedWithin(scope, varName, predicateNames)) return { ok: true }
    if (hasCast) {
      return {
        ok: false,
        reason: `\`${varName}\` is cast (\`as\`/\`<T>\`) with no runtime narrowing applied to it anywhere in the function`,
      }
    }
    if (isUsedStructurally(scope, varName)) {
      return {
        ok: false,
        reason:
          `\`${varName}\` is used structurally (a property/element access, or Number()/parseInt()/parseFloat()) ` +
          'before reaching app state, with no typeof/Array.isArray/instanceof/in/.parse(/local-predicate narrowing found',
      }
    }
    if (enclosingFunctionClaimsNarrowerType(callExpr)) {
      return {
        ok: false,
        reason:
          'the enclosing function declares a return type narrower than what getItem() actually returns ' +
          `(string | null), but \`${varName}\` reaches it with no typeof/Array.isArray/instanceof/in/.parse(` +
          '/local-predicate narrowing found in this file — a predicate imported from elsewhere cannot be ' +
          'confirmed from the AST and does not count',
      }
    }
    return { ok: true }
  }

  if (hasCast) {
    return {
      ok: false,
      reason: 'the getItem() result is cast (`as`/`<T>`) with no runtime narrowing anywhere in the function',
    }
  }
  return { ok: true }
}

/**
 * @param {ts.SourceFile} sf
 * @param {string} rel
 * @returns {{ accessFindings: AccessFinding[], narrowingFindings: NarrowingFinding[], accessCount: number, getItemCount: number }}
 */
function scanFileForRules1And2(sf, rel) {
  const predicateNames = collectTypePredicateNames(sf)
  /** @type {AccessFinding[]} */
  const accessFindings = []
  /** @type {NarrowingFinding[]} */
  const narrowingFindings = []
  let accessCount = 0
  let getItemCount = 0
  /** @param {ts.Node} node @returns {number} 1-based line */
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

  /** @param {ts.Node} node */
  function visit(node) {
    if (
      (ts.isPropertyAccessExpression(node) && isStorageObjectExpr(node.expression)) ||
      (ts.isElementAccessExpression(node) && isStorageObjectExpr(node.expression))
    ) {
      accessCount += 1
      if (!hasTryAncestor(node)) {
        accessFindings.push({ file: rel, line: lineOf(node), text: normalise(node.getText(sf)) })
      }
      // Rule 2: only a call to `.getItem` on a recognised storage object carries a value that
      // can reach app state.
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === 'getItem' &&
        node.parent &&
        ts.isCallExpression(node.parent) &&
        node.parent.expression === node
      ) {
        getItemCount += 1
        const verdict = classifyReadSite(node.parent, predicateNames)
        if (!verdict.ok) {
          narrowingFindings.push({
            file: rel,
            line: lineOf(node.parent),
            text: normalise(node.parent.getText(sf)),
            reason: verdict.reason,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { accessFindings, narrowingFindings, accessCount, getItemCount }
}

/**
 * Every string literal `isPersistableKey`'s body compares a key against — `===`/`!==`/`==`/
 * `!=`, a `switch` `case` label, or an array literal's `.includes(...)` argument.
 *
 * @param {ts.Node} body
 * @returns {Set<string>}
 */
function collectKeyLiterals(body) {
  /** @type {Set<string>} */
  const literals = new Set()
  /** @param {ts.Node} node */
  function visit(node) {
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(node.operatorToken.kind)
    ) {
      if (ts.isStringLiteralLike(node.left)) literals.add(node.left.text)
      if (ts.isStringLiteralLike(node.right)) literals.add(node.right.text)
    } else if (ts.isCaseClause(node) && ts.isStringLiteralLike(node.expression)) {
      literals.add(node.expression.text)
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'includes' &&
      ts.isArrayLiteralExpression(node.expression.expression)
    ) {
      for (const el of node.expression.expression.elements) {
        if (ts.isStringLiteralLike(el)) literals.add(el.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(body)
  return literals
}

/**
 * Every function/arrow/function-expression named exactly `isPersistableKey` anywhere in `sf`,
 * with the set of key literals its body checks against.
 *
 * @param {ts.SourceFile} sf
 * @returns {{ found: boolean, literals: Set<string> }}
 */
function findIsPersistableKey(sf) {
  let found = false
  /** @type {Set<string>} */
  const literals = new Set()
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'isPersistableKey' && node.body) {
      found = true
      for (const lit of collectKeyLiterals(node.body)) literals.add(lit)
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'isPersistableKey' &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      found = true
      for (const lit of collectKeyLiterals(node.initializer.body)) literals.add(lit)
    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'isPersistableKey' && node.body) {
      found = true
      for (const lit of collectKeyLiterals(node.body)) literals.add(lit)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { found, literals }
}

/**
 * @typedef {{ key: string, added: string, reason: string }} BaselineEntry
 * @typedef {{ createdAt: string, note: string, entries: BaselineEntry[] }} Baseline
 */

/** @param {unknown} reason @returns {string | null} */
function reasonProblem(reason) {
  if (typeof reason !== 'string') return 'reason is missing'
  const t = reason.trim()
  if (!t) return 'reason is empty'
  if (t.length < MIN_REASON_LENGTH) return `reason is shorter than ${MIN_REASON_LENGTH} characters (${t.length})`
  return null
}

/**
 * @returns {{ baseline: Baseline, problems: string[] }}
 */
function loadAndValidateBaseline() {
  /** @type {string} */
  let raw
  try {
    raw = readFileSync(BASELINE_PATH, 'utf8')
  } catch (err) {
    throw new Error(`persist-boundary: ${BASELINE_REL} is missing or unreadable: ${errMessage(err)}`)
  }
  /** @type {any} */
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`persist-boundary: ${BASELINE_REL} is not valid JSON: ${errMessage(err)}`)
  }
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`persist-boundary: ${BASELINE_REL} has no "entries" array.`)
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
        `${label} (${key}): "reason" ${problem} — a stub reason is not review, it is a hole. Read the code ` +
          'this key names and write a real one.',
      )
    }
  })

  return { baseline: parsed, problems }
}

function main() {
  /** @type {string[]} */
  let files
  try {
    files = listCandidateFiles()
  } catch (err) {
    process.stderr.write(`persist-boundary: RED\n  ${errMessage(err)}\n`)
    process.exit(1)
    return
  }

  /** @type {AccessFinding[]} */
  const accessFindings = []
  /** @type {NarrowingFinding[]} */
  const narrowingFindings = []
  /** @type {Set<string>} */
  const foundKeyLiterals = new Set()
  let isPersistableKeyFound = false
  let totalAccessCount = 0
  let totalGetItemCount = 0
  let filesTouched = 0

  for (const rel of files) {
    const sf = parseFile(rel)
    if (!sf) continue
    const { accessFindings: af, narrowingFindings: nf, accessCount, getItemCount } = scanFileForRules1And2(sf, rel)
    if (accessCount > 0) filesTouched += 1
    totalAccessCount += accessCount
    totalGetItemCount += getItemCount
    accessFindings.push(...af)
    narrowingFindings.push(...nf)

    const { found, literals } = findIsPersistableKey(sf)
    if (found) {
      isPersistableKeyFound = true
      for (const lit of literals) foundKeyLiterals.add(lit)
    }
  }

  accessFindings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  narrowingFindings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)

  const { baseline, problems: baselineProblems } = loadAndValidateBaseline()

  /** @type {string[]} */
  const problems = [...baselineProblems]

  if (baselineProblems.length === 0) {
    if (!isPersistableKeyFound) {
      problems.push(
        'RULE 3: no function/arrow/function-expression named `isPersistableKey` was found anywhere under ' +
          `${FRONTEND_SRC} — has it been renamed or moved? This ratchet cannot compare an allowlist it cannot find.`,
      )
    } else {
      const baselineKeys = new Set(baseline.entries.map((e) => e.key))
      for (const key of foundKeyLiterals) {
        if (!baselineKeys.has(key)) {
          problems.push(
            `RULE 3 — NEW KEY: isPersistableKey checks against ${JSON.stringify(key)}, which is not in ` +
              `${BASELINE_REL}. Persisting a new query key must be a reviewed, dated addition to that file, ` +
              'with a real reason, before this check can pass.',
          )
        }
      }
      for (const entry of baseline.entries) {
        if (!foundKeyLiterals.has(entry.key)) {
          problems.push(
            `RULE 3 — STALE ENTRY: ${BASELINE_REL} records ${JSON.stringify(entry.key)} but isPersistableKey ` +
              'no longer checks against it. Delete the entry — this ratchet only shrinks.',
          )
        }
      }
    }
  }

  for (const f of accessFindings) {
    problems.push(
      `RULE 1 — UNGUARDED ACCESS: ${f.file}:${f.line} — \`${f.text}\` has no enclosing try/catch. The accessor ` +
        'itself can throw in a private window, and this module graph is imported at bootstrap, so an unguarded ' +
        'throw here is a blank page.',
    )
  }
  for (const f of narrowingFindings) {
    problems.push(`RULE 2 — UNNARROWED READ: ${f.file}:${f.line} — \`${f.text}\` — ${f.reason}.`)
  }

  if (problems.length > 0) {
    process.stderr.write('persist-boundary: RED\n')
    for (const p of problems.sort()) process.stderr.write(`  ${p}\n`)
    process.exit(1)
    return
  }

  process.stdout.write(
    `persist-boundary: ${totalAccessCount} localStorage/sessionStorage access(es) across ${filesTouched} file(s), ` +
      `all guarded by try/catch; ${totalGetItemCount} getItem() read(s), all narrowed or opaque; ` +
      `isPersistableKey's allowlist matches ${BASELINE_REL} exactly (${baseline.entries.length} key(s), ` +
      `${baseline.createdAt})\n`,
  )
}

main()
