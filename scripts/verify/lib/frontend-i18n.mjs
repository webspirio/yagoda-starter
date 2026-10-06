/**
 * What the two i18n rows read from frontend/src, parsed once.
 *
 * `plain-text` asks "does shipped UI code render a literal?" and `locales` asks "does every
 * literal t() key exist?". Both need the same AST over the same file set, and one
 * enumeration means the two rows cannot disagree about what "the frontend" is.
 *
 * Syntax only — `ts.createSourceFile`, never a Program — so neither row is ordered behind
 * `typecheck`: a file that does not type-check still parses.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { errMessage } from '../hash.mjs'
import { gitEnv } from '../scan-root.mjs'

export const FRONTEND_SRC = 'frontend/src'

/** Tests and test setup are not shipped; `locales/` is data, and the `locales` row's input. */
const NOT_SHIPPED_UI = /(\.test\.|(^|\/)test-setup\.tsx?$|\/locales\/)/

/** Attributes a user reads or a screen reader speaks. A fixed list on purpose (spec D9). */
const UI_ATTRIBUTES = new Set(['placeholder', 'title', 'alt', 'label', 'description', 'aria-label', 'aria-description'])

const LETTER = /\p{L}/u
const CYRILLIC = /[Ѐ-ӿ]/

/**
 * @typedef {'jsx-text' | 'jsx-attr' | 'toast' | 'cyrillic'} Rule
 * @typedef {{ file: string, line: number, col: number, rule: Rule, text: string }} Candidate
 * @typedef {{ file: string, line: number, col: number, key: string }} KeyUse
 */

/** @param {string} s */
export const normalise = (s) => s.replace(/\s+/g, ' ').trim()

/**
 * Tracked plus untracked-not-ignored files, so a new file is scanned before its first commit.
 *
 * @param {string} root
 * @param {string} pathspec
 * @returns {string[]} repo-relative, sorted
 */
export function listUnder(root, pathspec) {
  let raw
  try {
    raw = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z', '--', pathspec], {
      cwd: root,
      env: gitEnv(),
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (err) {
    throw new Error(`git could not enumerate ${pathspec} under ${root}: ${errMessage(err)}`)
  }
  return [...new Set(raw.toString('utf8').split('\0').filter(Boolean))].sort()
}

/** @param {string} root @returns {string[]} */
export function frontendSourceFiles(root) {
  return listUnder(root, FRONTEND_SRC).filter((f) => /\.tsx?$/.test(f) && !NOT_SHIPPED_UI.test(f))
}

/** @param {ts.Node | undefined} node @returns {ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | undefined} */
const literal = (node) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node : undefined

const PASS_THROUGH = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
])

/**
 * The string or template literals an expression can evaluate to as-is: through parentheses,
 * both branches of `?:`, and either side of `&&` / `||` / `??`. A condition, a call or a
 * comparison is not followed — `x === 'warning'` is never text.
 *
 * @param {ts.Expression | undefined} expr
 * @returns {(ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression)[]}
 */
function textLiterals(expr) {
  if (!expr) return []
  if (ts.isParenthesizedExpression(expr)) return textLiterals(expr.expression)
  if (ts.isConditionalExpression(expr)) return [...textLiterals(expr.whenTrue), ...textLiterals(expr.whenFalse)]
  if (ts.isBinaryExpression(expr) && PASS_THROUGH.has(expr.operatorToken.kind)) {
    return [...textLiterals(expr.left), ...textLiterals(expr.right)]
  }
  const lit = literal(expr)
  if (lit) return [lit]
  return ts.isTemplateExpression(expr) ? [expr] : []
}

/** `toast(…)`, `toast.x(…)`, `toastSuccess(…)` — the sonner API and its local wrappers. */
const isToastCallee = (/** @type {ts.Expression} */ e) =>
  (ts.isIdentifier(e) && e.text.startsWith('toast')) ||
  (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'toast')

/** `t(…)` or `i18n.t(…)`. */
const isTCallee = (/** @type {ts.Expression} */ e) =>
  (ts.isIdentifier(e) && e.text === 't') ||
  (ts.isPropertyAccessExpression(e) && e.name.text === 't' && ts.isIdentifier(e.expression) && e.expression.text === 'i18n')

/**
 * @param {string} rel repo-relative path, used in the report and to pick TS vs TSX
 * @param {string} text file contents
 * @returns {{ candidates: Candidate[], keys: KeyUse[] }}
 */
export function scanSource(rel, text) {
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind)
  /** @type {Candidate[]} */
  const candidates = []
  /** @type {KeyUse[]} */
  const keys = []
  // A node can satisfy two rules (an aria-label in Cyrillic); the walk meets the parent rule
  // first, and this set keeps the literal from being reported again as `cyrillic`.
  /** @type {Set<ts.Node>} */
  const seen = new Set()

  /** @param {number} pos */
  const at = (pos) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(pos)
    return { line: line + 1, col: character + 1 }
  }
  /** @param {ts.Node} node @param {Rule} rule @param {string} raw @param {number} [pos] */
  const flag = (node, rule, raw, pos = node.getStart(sf)) => {
    if (seen.has(node)) return
    seen.add(node)
    candidates.push({ file: rel, ...at(pos), rule, text: normalise(raw) })
  }
  /** @param {ts.Expression | undefined} expr @param {Rule} rule */
  const flagLiteral = (expr, rule) => {
    for (const lit of textLiterals(expr)) {
      if (ts.isTemplateExpression(lit)) {
        // Its head and spans are the nodes the `cyrillic` rule would meet next.
        for (const part of [lit.head, ...lit.templateSpans.map((s) => s.literal)]) seen.add(part)
        const parts = lit.head.text + lit.templateSpans.map((s) => s.literal.text).join('')
        if (LETTER.test(parts)) flag(lit, rule, lit.getText(sf).slice(1, -1))
      } else if (LETTER.test(lit.text)) {
        flag(lit, rule, lit.text)
      }
    }
  }

  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isJsxText(node) && LETTER.test(node.text)) {
      // JsxText starts at the whitespace before it; point at the first real character.
      flag(node, 'jsx-text', node.text, node.pos + (node.text.length - node.text.trimStart().length))
    } else if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      // `{'Close'}` or `{x ? 'Yes' : 'No'}` as a child renders exactly like JSX text.
      flagLiteral(node.expression, 'jsx-text')
    } else if (ts.isJsxAttribute(node) && UI_ATTRIBUTES.has(node.name.getText(sf))) {
      const init = node.initializer
      flagLiteral(init && ts.isJsxExpression(init) ? init.expression : literal(init), 'jsx-attr')
    } else if (ts.isCallExpression(node)) {
      if (isToastCallee(node.expression)) {
        flagLiteral(node.arguments[0], 'toast')
        const options = node.arguments[1]
        if (options && ts.isObjectLiteralExpression(options)) {
          for (const p of options.properties) {
            if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'description') flagLiteral(p.initializer, 'toast')
          }
        }
      } else if (isTCallee(node.expression)) {
        const lit = literal(node.arguments[0])
        if (lit) keys.push({ file: rel, ...at(lit.getStart(sf)), key: lit.text })
      }
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
      CYRILLIC.test(node.text)
    ) {
      flag(node, 'cyrillic', node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { candidates, keys }
}

/**
 * @param {string} root
 * @returns {{ files: string[], candidates: Candidate[], keys: KeyUse[] }}
 */
export function scanFrontend(root) {
  const files = frontendSourceFiles(root)
  /** @type {Candidate[]} */
  const candidates = []
  /** @type {KeyUse[]} */
  const keys = []
  /** @type {string[]} */
  const scanned = []
  for (const rel of files) {
    let text
    try {
      text = readFileSync(path.join(root, rel), 'utf8')
    } catch (err) {
      // `ls-files -c` still lists a tracked file deleted but not yet staged; mid-refactor that
      // is a legitimate tree, not a red one. Any other read failure stays loud.
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') continue
      throw err
    }
    scanned.push(rel)
    const found = scanSource(rel, text)
    candidates.push(...found.candidates)
    keys.push(...found.keys)
  }
  return { files: scanned, candidates, keys }
}

/**
 * Flatten a locale object into dotted leaf paths. An empty object has no leaves, so it
 * would vanish silently; it is returned separately so the caller can refuse it.
 *
 * @param {unknown} node
 * @returns {{ leaves: Map<string, unknown>, emptyObjects: string[] }}
 */
export function flattenLocale(node) {
  /** @type {Map<string, unknown>} */
  const leaves = new Map()
  /** @type {string[]} */
  const emptyObjects = []
  /** @param {unknown} n @param {string} prefix */
  const walk = (n, prefix) => {
    if (n !== null && typeof n === 'object' && !Array.isArray(n)) {
      const entries = Object.entries(n)
      if (entries.length === 0 && prefix) emptyObjects.push(prefix)
      for (const [k, v] of entries) walk(v, prefix ? `${prefix}.${k}` : k)
    } else {
      leaves.set(prefix, n)
    }
  }
  walk(node, '')
  return { leaves, emptyObjects }
}
