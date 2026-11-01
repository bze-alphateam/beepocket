import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-deps.mjs');

let root;

function write(pkg, manifest) {
  const dir = pkg ? join(root, 'packages', pkg) : root;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
}

function baseline() {
  write('', { name: 'root', devDependencies: { typescript: '6.0.3' } });
  write('core', { name: '@beepocket/core', dependencies: { '@noble/hashes': '2.0.0' } });
  write('extension', {
    name: '@beepocket/extension',
    dependencies: { '@beepocket/core': 'workspace:*', preact: '11.1.1', '@scure/base': '2.0.0' },
    devDependencies: { esbuild: '0.28.2' },
  });
  write('connector', { name: '@bze/beepocket-connector' });
}

function run() {
  return spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-deps-'));
  baseline();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('check-deps CLI', () => {
  it('passes on an allowlisted, exactly pinned tree', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ok');
  });

  it('fails on a runtime dependency outside the allowlist', () => {
    write('core', { name: '@beepocket/core', dependencies: { lodash: '4.17.21' } });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lodash');
  });

  it('fails on a caret version', () => {
    write('extension', { name: '@beepocket/extension', dependencies: { preact: '^11.1.1' } });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not an exact version');
  });

  it('fails on a caret version in devDependencies', () => {
    write('', { name: 'root', devDependencies: { typescript: '~6.0.3' } });
    expect(run().status).toBe(1);
  });

  it('fails when the connector has a runtime dependency', () => {
    write('connector', { name: 'c', dependencies: { preact: '11.1.1' } });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('connector');
  });

  it('allows @beepocket/core only as workspace:*', () => {
    write('extension', { name: 'e', dependencies: { '@beepocket/core': 'workspace:*' } });
    expect(run().status).toBe(0);
    write('extension', { name: 'e', dependencies: { '@beepocket/core': '0.0.0' } });
    expect(run().status).toBe(1);
  });

  it('ignores devDependencies for the allowlist', () => {
    write('core', { name: 'c', devDependencies: { vitest: '5.0.5' } });
    expect(run().status).toBe(0);
  });
});
