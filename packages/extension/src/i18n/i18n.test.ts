import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en, t } from '.';

const srcDir = join(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('t', () => {
  it('returns the string for a key', () => {
    expect(t('app.name')).toBe('BeePocket');
  });

  it('fills placeholders', () => {
    expect(t('app.version', { version: '1.2.3' })).toBe('Version 1.2.3');
  });

  it('leaves unknown placeholders and ignores inherited names', () => {
    expect(t('app.version', {})).toBe('Version {version}');
    expect(t('app.version', { other: 1 })).toBe('Version {version}');
  });
});

describe('en', () => {
  it('has only non-empty strings', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value, key).not.toBe('');
    }
  });

  it('defines every key referenced as t("...") in the source', () => {
    const missing: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([\w.]+)'/g)) {
        const key = m[1] ?? '';
        if (!Object.hasOwn(en, key)) missing.push(`${relative(srcDir, file)}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps each module to its own prefix, so features never share a file', () => {
    const modules = readdirSync(join(srcDir, 'i18n')).filter(
      (n) => n.endsWith('.ts') && !n.endsWith('.test.ts') && !['en.ts', 'index.ts'].includes(n),
    );
    let total = 0;
    for (const file of modules) {
      const prefix = `${file.replace(/\.ts$/, '')}.`;
      const keys = [
        ...readFileSync(join(srcDir, 'i18n', file), 'utf8').matchAll(/^\s*'([\w.]+)':/gm),
      ].map((m) => m[1] ?? '');
      for (const key of keys) expect(key.startsWith(prefix), `${file}: ${key}`).toBe(true);
      total += keys.length;
    }
    expect(Object.keys(en)).toHaveLength(total);
  });
});
