#!/usr/bin/env node
/**
 * The locale files agree with each other and with the code that reads them.
 *
 * en.json is the reference. Every other locale beside it must carry the same keys (plural
 * suffixes normalised), every plural category its language needs, no empty value, and the
 * same {{placeholders}}. Every literal key the frontend passes to t() must exist in en.json.
 * A miss on any of these reaches the screen as a raw key, a wrong plural form, or a blank.
 *
 * The plural categories come from Intl.PluralRules, not a list kept here, so a locale added
 * later is checked against its own grammar for free. The language set comes from
 * SUPPORTED_LANGUAGES, and a locale name Intl does not know is refused rather than checked
 * against the host's default grammar.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

import { errMessage } from '../hash.mjs'
import { FRONTEND_SRC, flattenLocale, listUnder, scanFrontend } from '../lib/frontend-i18n.mjs'
import { refuseEmptyScan, scanRoot } from '../scan-root.mjs'

const ROOT = scanRoot()
const PLURAL = /_(zero|one|two|few|many|other)$/
const PLACEHOLDER = /\{\{-?\s*([^,}\s]+)[^}]*\}\}/g
const LANGUAGE_PREFERENCE = 'frontend/src/shared/lib/i18n/language-preference.ts'

/** @typedef {import('../lib/frontend-i18n.mjs').KeyUse} KeyUse */

/** @param {string} key */
const baseOf = (key) => key.replace(PLURAL, '')

/** @param {Set<string>} s */
const show = (s) => `{${[...s].sort().join(', ')}}`

/** The languages the app loads — read from the app, never kept here as a second copy. @param {string} root */
export function supportedLanguages(root) {
  const rel = LANGUAGE_PREFERENCE
  let text
  try {
    text = readFileSync(path.join(root, rel), 'utf8')
  } catch (err) {
    throw new Error(`cannot read ${rel}: ${errMessage(err)}`)
  }
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  /** @type {string[]} */
  let langs = []
  /** @param {ts.Node} n */
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'SUPPORTED_LANGUAGES' && n.initializer) {
      let init = n.initializer
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression
      if (ts.isArrayLiteralExpression(init)) {
        langs = init.elements.filter(ts.isStringLiteral).map((e) => e.text)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  if (!langs.length) throw new Error(`${rel} declares no SUPPORTED_LANGUAGES string array`)
  return langs
}

/** Base keys carrying a plural suffix in any locale. @param {Map<string, unknown>} locales */
export function pluralFamilies(locales) {
  return new Set(
    [...locales.values()].flatMap((raw) => [...flattenLocale(raw).leaves.keys()].filter((k) => PLURAL.test(k)).map(baseOf)),
  )
}

/**
 * @param {Map<string, unknown>} leaves
 * @returns {Map<string, Set<string>>} base key -> union of placeholder names over its forms
 */
function placeholdersByBase(leaves) {
  /** @type {Map<string, Set<string>>} */
  const out = new Map()
  for (const [key, value] of leaves) {
    const set = out.get(baseOf(key)) ?? new Set()
    if (typeof value === 'string') for (const m of value.matchAll(PLACEHOLDER)) set.add(m[1])
    out.set(baseOf(key), set)
  }
  return out
}

/**
 * @param {Map<string, unknown>} locales lang -> parsed JSON
 * @param {KeyUse[]} keyUses
 * @param {string[]} supported languages the app loads
 * @returns {string[]} sorted problem lines; empty means green
 */
export function checkLocales(locales, keyUses, supported) {
  const enRaw = locales.get('en')
  if (enRaw === undefined) return ['en.json is missing — it is the reference every other locale is compared with']

  /** @type {string[]} */
  const problems = []
  for (const lang of supported) if (!locales.has(lang)) problems.push(`${lang}.json is missing — SUPPORTED_LANGUAGES lists "${lang}"`)
  for (const lang of locales.keys()) if (!supported.includes(lang)) problems.push(`${lang}.json is not in SUPPORTED_LANGUAGES — the app never loads it`)
  const flat = new Map([...locales].map(([lang, raw]) => [lang, flattenLocale(raw)]))
  const en = flattenLocale(enRaw)
  const enBases = new Set([...en.leaves.keys()].map(baseOf))
  const enPlaceholders = placeholdersByBase(en.leaves)
  const families = pluralFamilies(locales)

  for (const [lang, { leaves, emptyObjects }] of flat) {
    const file = `${lang}.json`
    for (const k of emptyObjects) problems.push(`${file}: "${k}" is an empty object`)
    for (const [k, v] of leaves) {
      if (typeof v !== 'string') problems.push(`${file}: "${k}" is not a string`)
      else if (v.trim() === '') problems.push(`${file}: "${k}" is empty`)
    }

    const rules = new Intl.PluralRules(lang)
    const resolved = rules.resolvedOptions().locale
    const known = Intl.PluralRules.supportedLocalesOf([lang]).length > 0 && resolved.split('-')[0] === lang.split('-')[0]
    if (!known) {
      problems.push(`${file}: Intl has no plural rules for "${lang}" — it would borrow the host's (${resolved})`)
    } else {
      for (const family of families) {
        for (const cat of rules.resolvedOptions().pluralCategories) {
          if (!leaves.has(`${family}_${cat}`)) problems.push(`${file}: plural family "${family}" is missing "${family}_${cat}"`)
        }
      }
    }

    if (lang === 'en') continue
    const bases = new Set([...leaves.keys()].map(baseOf))
    for (const b of enBases) if (!bases.has(b)) problems.push(`${file} is missing "${b}"`)
    for (const b of bases) if (!enBases.has(b)) problems.push(`${file} has "${b}", which en.json does not`)

    for (const [b, names] of placeholdersByBase(leaves)) {
      const ref = enPlaceholders.get(b)
      if (ref && show(ref) !== show(names)) problems.push(`${file}: "${b}" uses placeholders ${show(names)}, en.json uses ${show(ref)}`)
    }
  }

  for (const u of keyUses) {
    if (!en.leaves.has(u.key) && !(families.has(u.key) && enBases.has(u.key))) {
      problems.push(`${u.file}:${u.line}:${u.col}  t('${u.key}') — en.json has no such key`)
    }
  }
  return problems.sort()
}

/** @param {string} [root] */
function scan(root = ROOT) {
  const localeFiles = listUnder(root, FRONTEND_SRC).filter((f) => /\/locales\/[^/]+\.json$/.test(f))
  const dirs = new Set(localeFiles.map((f) => path.dirname(f)))
  if (dirs.size > 1) throw new Error(`locale files live in more than one directory: ${[...dirs].join(', ')}`)

  /** @type {Map<string, unknown>} */
  const locales = new Map()
  for (const f of localeFiles) {
    try {
      locales.set(path.basename(f, '.json'), JSON.parse(readFileSync(path.join(root, f), 'utf8')))
    } catch (err) {
      throw new Error(`${f} is not valid JSON: ${errMessage(err)}`)
    }
  }
  const { files, keys } = scanFrontend(root)
  const leafCount = locales.has('en') ? flattenLocale(locales.get('en')).leaves.size : 0
  return {
    files,
    localeFiles,
    keyCount: keys.length,
    leafCount,
    pluralFamilyCount: pluralFamilies(locales).size,
    problems: localeFiles.length ? checkLocales(locales, keys, supportedLanguages(root)) : [],
  }
}

function main() {
  let result
  try {
    result = scan()
  } catch (err) {
    process.stderr.write(`locales: RED\n  ${errMessage(err)}\n`)
    process.exit(1)
    return
  }
  refuseEmptyScan('locales', result.localeFiles.length, 'locale files', ROOT)
  refuseEmptyScan('locales', result.files.length, 'frontend source files', ROOT)
  refuseEmptyScan('locales', result.pluralFamilyCount, 'plural families', ROOT)

  if (result.problems.length) {
    process.stderr.write('locales: RED\n')
    for (const p of result.problems) process.stderr.write(`  ${p}\n`)
    process.exit(1)
  }
  process.stdout.write(
    `locales: ${result.localeFiles.map((f) => path.basename(f)).join(', ')} agree on en.json's ${result.leafCount} keys, ` +
      `and all ${result.keyCount} literal keys in ${result.files.length} frontend source files exist\n`,
  )
}

if (process.argv[1]?.endsWith('locales.mjs')) main()
