import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const protoDir = join(import.meta.dirname, 'proto');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const sources = files(protoDir).filter((f) => f.endsWith('.ts'));

describe('copied protobuf code', () => {
  it('has no @interchainjs import left', () => {
    for (const f of sources) {
      const imports = readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => /^\s*(import|export)\b.*from\s/.test(l));
      expect(imports.join('\n'), f).not.toContain('@interchainjs');
    }
  });

  it('imports nothing outside the dependency allowlist', () => {
    for (const f of sources) {
      const bare = [...readFileSync(f, 'utf8').matchAll(/from\s+["']([^."'][^"']*)["']/g)].map(
        (m) => m[1] ?? '',
      );
      for (const spec of bare) expect(spec, f).toMatch(/^@(noble|scure)\//);
    }
  });

  it('lists every copied file in the README', () => {
    const readme = readFileSync(join(protoDir, 'README.md'), 'utf8');
    for (const f of sources) {
      const rel = relative(protoDir, f);
      if (rel === 'registry.ts' || rel === 'decimal.ts') continue;
      expect(readme, rel).toContain(`\`${rel}\``);
    }
  });

  it('marks each copied file with its origin', () => {
    for (const f of sources) {
      const rel = relative(protoDir, f);
      if (rel === 'registry.ts' || rel === 'decimal.ts') continue;
      expect(readFileSync(f, 'utf8').split('\n')[0], rel).toMatch(
        /^\/\/ Copied from @bze\/bzejs \d+\.\d+\.\d+ \(src\//,
      );
    }
  });
});
