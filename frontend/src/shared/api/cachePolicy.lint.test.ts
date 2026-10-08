import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

// `import.meta.dirname` is real at runtime (Vitest runs on Node) but untyped here:
// `src` compiles against DOM types only, and this file needs no more of Node than this.
const here = (import.meta as ImportMeta & { dirname: string }).dirname;
const eslint = new ESLint({ cwd: `${here}/../../..` });

async function restricted(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message);
}

const HOOK = "export const options = { queryKey: ['x'], staleTime: 1000 };\n";
const PAGE = 'export function Page() { return <div>{String({ gcTime: 0 })}</div>; }\n';
const APP = 'export const client = { refetchOnWindowFocus: false };\n';
const INPUT = 'export function Page() { return <input />; }\n';

describe('eslint — freshness is decided in cachePolicy.ts only', () => {
  it.each([
    ['an entity hook (.ts)', HOOK, 'src/entities/foo/api/useFoo.ts'],
    ['a page component (.tsx)', PAGE, 'src/pages/foo/ui/FooPage.tsx'],
    ['an app module (.tsx)', PAGE, 'src/app/Foo.tsx'],
    ['a shared module (.ts)', APP, 'src/shared/api/other.ts'],
  ])('forbids a freshness option in %s', async (_label, code, filePath) => {
    const messages = await restricted(code, filePath);
    expect(messages.some((m) => m.includes('cachePolicy.ts'))).toBe(true);
  });

  it.each([
    ['cachePolicy.ts itself', HOOK, 'src/shared/api/cachePolicy.ts'],
    ['a test file (.ts)', HOOK, 'src/entities/foo/api/useFoo.test.ts'],
    ['a test file (.tsx)', PAGE, 'src/pages/foo/ui/FooPage.test.tsx'],
  ])('allows it in %s', async (_label, code, filePath) => {
    expect(await restricted(code, filePath)).toEqual([]);
  });

  it.each([
    ['a page component', 'src/pages/foo/ui/FooPage.tsx'],
    ['a page test', 'src/pages/foo/ui/FooPage.test.tsx'],
  ])('still forbids a raw <input> in %s', async (_label, filePath) => {
    const messages = await restricted(INPUT, filePath);
    expect(messages.some((m) => m.includes('<TextInput>'))).toBe(true);
  });
});
