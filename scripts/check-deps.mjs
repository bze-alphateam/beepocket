#!/usr/bin/env node
// Dependency policy: runtime dependencies are limited to an allowlist and every
// version in every package.json must be pinned exactly.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME_PACKAGES = ['core', 'extension'];
const NO_RUNTIME_PACKAGES = ['connector'];
// The connector is published to npm: it brings nothing of its own and only peers on the wallet kit.
const CONNECTOR_PEERS = ['@interchain-kit/core'];
const CONNECTOR_NAME = '@bze/beepocket-connector';
const ALLOWED = [/^@noble\/[^/]+$/, /^@scure\/[^/]+$/, /^preact$/];
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

function read(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function isAllowedRuntime(name, version) {
  if (name === '@beepocket/core') return version === 'workspace:*';
  return ALLOWED.some((re) => re.test(name));
}

export function checkDeps(root) {
  const errors = [];
  const manifests = [
    ['package.json', join(root, 'package.json')],
    ...[...RUNTIME_PACKAGES, ...NO_RUNTIME_PACKAGES].map((p) => [
      `packages/${p}/package.json`,
      join(root, 'packages', p, 'package.json'),
    ]),
  ];

  for (const [label, file] of manifests) {
    if (!existsSync(file)) {
      errors.push(`${label}: missing`);
      continue;
    }
    const manifest = read(file);
    const pkg = label.split('/')[1];

    for (const field of FIELDS) {
      for (const [name, version] of Object.entries(manifest[field] ?? {})) {
        const workspace =
          version === 'workspace:*' && (name === '@beepocket/core' || name === CONNECTOR_NAME);
        if (!workspace && !EXACT.test(version)) {
          errors.push(`${label}: ${field}.${name} is not an exact version (${version})`);
        }
      }
    }

    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, version] of Object.entries(manifest[field] ?? {})) {
        if (NO_RUNTIME_PACKAGES.includes(pkg)) {
          if (field === 'peerDependencies' && CONNECTOR_PEERS.includes(name)) continue;
          errors.push(
            `${label}: ${field}.${name} is not allowed (connector has no runtime dependencies)`,
          );
        } else if (RUNTIME_PACKAGES.includes(pkg) && !isAllowedRuntime(name, version)) {
          errors.push(`${label}: ${field}.${name} is not on the runtime allowlist`);
        }
      }
    }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const errors = checkDeps(root);
  if (errors.length > 0) {
    for (const e of errors) console.error(`check-deps: ${e}`);
    process.exit(1);
  }
  console.log('check-deps: ok');
}
