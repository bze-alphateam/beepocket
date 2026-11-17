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

const WORKSPACE = ['packages/core', 'packages/extension', 'packages/connector'];

function workspace(entries) {
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    `packages:\n${entries.map((e) => `  - ${e}\n`).join('')}allowBuilds:\n  esbuild: false\n`,
  );
}

const META = join('packages', 'extension', 'bundle-meta.json');
const pnpmPath = (pkg, version, file) =>
  `../../node_modules/.pnpm/${pkg.replace('/', '+')}@${version}/node_modules/${pkg}/${file}`;

function metafile(inputs) {
  const file = join(root, META);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      inputs: Object.fromEntries(inputs.map((i) => [i, { bytes: 1, imports: [] }])),
    }),
  );
}

const allowedInputs = [
  'src/popup/main.tsx',
  'src/service-worker.ts',
  '../core/src/index.ts',
  pnpmPath('preact', '11.1.1', 'jsx-runtime/dist/jsxRuntime.module.js'),
  pnpmPath('preact', '11.1.1', 'dist/preact.module.js'),
  pnpmPath('@noble/hashes', '2.4.0', 'sha2.js'),
  pnpmPath('@noble/curves', '2.4.0', 'secp256k1.js'),
  pnpmPath('@scure/base', '2.4.0', 'index.js'),
];

function baseline() {
  workspace(WORKSPACE);
  write('', { name: 'root', devDependencies: { typescript: '6.0.3' } });
  write('core', { name: '@beepocket/core', dependencies: { '@noble/hashes': '2.0.0' } });
  write('extension', {
    name: '@beepocket/extension',
    dependencies: { '@beepocket/core': 'workspace:*', preact: '11.1.1', '@scure/base': '2.0.0' },
    devDependencies: { esbuild: '0.28.2' },
  });
  write('connector', { name: '@bze/beepocket-connector' });
}

function run(...args) {
  return spawnSync(process.execPath, [script, root, ...args], { encoding: 'utf8' });
}

function runBundle() {
  return run('--metafile', META);
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

  it('allows the connector to peer on interchain-kit, and nothing else', () => {
    write('connector', {
      name: 'c',
      peerDependencies: { '@interchain-kit/core': '0.11.x' },
      devDependencies: { '@interchain-kit/core': '0.11.0' },
    });
    expect(run().status).toBe(0);
    write('connector', { name: 'c', peerDependencies: { react: '19.0.0' } });
    expect(run().status).toBe(1);
    write('connector', { name: 'c', dependencies: { '@interchain-kit/core': '0.11.0' } });
    expect(run().status).toBe(1);
  });

  it('allows the extension to use the connector from the workspace as a dev dependency', () => {
    write('extension', {
      name: 'e',
      devDependencies: { '@bze/beepocket-connector': 'workspace:*' },
    });
    expect(run().status).toBe(0);
    write('extension', { name: 'e', devDependencies: { '@bze/beepocket-connector': '^1.0.0' } });
    expect(run().status).toBe(1);
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

describe('check-deps workspace discovery', () => {
  it('fails on a workspace package that has no dependency policy', () => {
    workspace([...WORKSPACE, 'packages/extra']);
    write('extra', { name: '@beepocket/extra', dependencies: { lodash: '4.17.21' } });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('packages/extra');
  });

  it('expands a directory glob and fails on a new package it finds', () => {
    workspace(['packages/*']);
    expect(run().status).toBe(0);
    write('extra', { name: '@beepocket/extra' });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('packages/extra');
  });

  it('fails when the workspace file is missing or lists no packages', () => {
    rmSync(join(root, 'pnpm-workspace.yaml'));
    expect(run().status).toBe(1);
    workspace([]);
    expect(run().status).toBe(1);
  });

  it('fails when a policy package is missing from the workspace', () => {
    workspace(['packages/core', 'packages/extension']);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('packages/connector');
  });
});

describe('check-deps bundle inputs', () => {
  it('passes when the bundle only uses allowlisted packages', () => {
    metafile(allowedInputs);
    const result = runBundle();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('@noble/hashes');
    expect(result.stdout).toContain('preact');
  });

  it('fails when a dev dependency is bundled', () => {
    metafile([...allowedInputs, pnpmPath('buffer', '6.0.3', 'index.js')]);
    const result = runBundle();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('buffer');
  });

  it('fails when a scoped dev dependency is bundled', () => {
    metafile([...allowedInputs, pnpmPath('@interchain-kit/core', '0.11.0', 'index.js')]);
    const result = runBundle();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('@interchain-kit/core');
  });

  it('fails when another workspace package is bundled', () => {
    metafile([...allowedInputs, '../connector/src/index.ts']);
    const result = runBundle();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('connector');
  });

  it('fails when the metafile is missing or empty', () => {
    expect(runBundle().status).toBe(1);
    metafile([]);
    expect(runBundle().status).toBe(1);
  });
});
