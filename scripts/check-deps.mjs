#!/usr/bin/env node
// Dependency policy: runtime dependencies are limited to an allowlist and every
// version in every package.json must be pinned exactly. Every workspace package
// needs a policy entry below.
//
// With `--metafile <path>` it checks an esbuild metafile of the extension build
// instead: every bundled input must come from the extension itself, from
// @beepocket/core or from an allowlisted runtime package.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Workspace directory -> policy. `runtime`: dependencies limited to the allowlist.
// `connector`: published to npm, brings nothing of its own and only peers on the wallet kit.
const POLICY = {
  'packages/core': 'runtime',
  'packages/extension': 'runtime',
  'packages/connector': 'connector',
};
const CONNECTOR_PEERS = ['@interchain-kit/core'];
const CONNECTOR_NAME = '@bze/beepocket-connector';
const ALLOWED = [/^@noble\/[^/]+$/, /^@scure\/[^/]+$/, /^preact$/];
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];
// Workspace directories whose source may end up in the extension bundle.
const BUNDLED_WORKSPACES = ['packages/extension', 'packages/core'];

function read(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function isAllowedRuntime(name, version) {
  if (name === '@beepocket/core') return version === 'workspace:*';
  return ALLOWED.some((re) => re.test(name));
}

// The `packages:` list of pnpm-workspace.yaml: plain directories or `dir/*` globs.
export function workspaceDirs(root) {
  const file = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(file)) return { dirs: [], errors: ['pnpm-workspace.yaml: missing'] };
  const errors = [];
  const entries = [];
  let inPackages = false;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trimEnd();
    if (line === '' || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ') && !line.startsWith('-')) {
      inPackages = line === 'packages:';
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s*-\s+(['"]?)(.+)\1$/.exec(line);
    if (item?.[2] === undefined) {
      errors.push(`pnpm-workspace.yaml: cannot read packages entry "${line.trim()}"`);
      continue;
    }
    entries.push(item[2].replace(/\/+$/, ''));
  }

  const dirs = [];
  for (const entry of entries) {
    if (entry.startsWith('!')) {
      errors.push(`pnpm-workspace.yaml: exclusion "${entry}" is not supported here`);
    } else if (entry.endsWith('/*') && !entry.slice(0, -2).includes('*')) {
      const parent = entry.slice(0, -2);
      const base = join(root, parent);
      if (!existsSync(base)) continue;
      for (const d of readdirSync(base, { withFileTypes: true })) {
        if (d.isDirectory() && existsSync(join(base, d.name, 'package.json'))) {
          dirs.push(`${parent}/${d.name}`);
        }
      }
    } else if (entry.includes('*')) {
      errors.push(`pnpm-workspace.yaml: pattern "${entry}" is not supported here`);
    } else {
      dirs.push(entry);
    }
  }
  if (entries.length === 0) errors.push('pnpm-workspace.yaml: no packages listed');
  return { dirs: [...new Set(dirs)].sort(), errors };
}

export function checkDeps(root) {
  const { dirs, errors } = workspaceDirs(root);
  for (const dir of dirs) {
    if (!(dir in POLICY)) errors.push(`${dir}: workspace package has no dependency policy`);
  }
  for (const dir of Object.keys(POLICY)) {
    if (!dirs.includes(dir)) errors.push(`${dir}: has a policy but is not in the workspace`);
  }

  const manifests = [
    ['package.json', join(root, 'package.json'), undefined],
    ...dirs.map((d) => [`${d}/package.json`, join(root, d, 'package.json'), POLICY[d]]),
  ];

  for (const [label, file, policy] of manifests) {
    if (!existsSync(file)) {
      errors.push(`${label}: missing`);
      continue;
    }
    const manifest = read(file);

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
        if (policy === 'connector') {
          if (field === 'peerDependencies' && CONNECTOR_PEERS.includes(name)) continue;
          errors.push(
            `${label}: ${field}.${name} is not allowed (connector has no runtime dependencies)`,
          );
        } else if (policy === 'runtime' && !isAllowedRuntime(name, version)) {
          errors.push(`${label}: ${field}.${name} is not on the runtime allowlist`);
        }
      }
    }
  }
  return errors;
}

// The package an input path belongs to: the part after the last node_modules/.
function packageOf(path) {
  const parts = path.split('/');
  const i = parts.lastIndexOf('node_modules');
  if (i < 0) return undefined;
  const first = parts[i + 1] ?? '';
  return first.startsWith('@') ? `${first}/${parts[i + 2] ?? ''}` : first;
}

// Inputs are relative to the directory of the metafile (the build's working directory).
export function checkBundle(root, metafile) {
  const file = resolve(root, metafile);
  if (!existsSync(file)) return { errors: [`${metafile}: missing (run the build first)`] };
  const inputs = Object.keys(read(file).inputs ?? {});
  if (inputs.length === 0) return { errors: [`${metafile}: no bundle inputs`] };

  const errors = [];
  const packages = new Set();
  for (const input of inputs) {
    const path = toPosix(input.replace(/^\(disabled\):/, ''));
    const name = packageOf(path);
    if (name !== undefined) {
      packages.add(name);
      if (!ALLOWED.some((re) => re.test(name)) && name !== '@beepocket/core') {
        errors.push(`bundle: ${name} is not on the runtime allowlist (${input})`);
      }
      continue;
    }
    const rel = toPosix(relative(root, resolve(dirname(file), path)));
    const owner = BUNDLED_WORKSPACES.find((d) => rel.startsWith(`${d}/`));
    if (owner === undefined) {
      errors.push(`bundle: ${input} is outside the extension and @beepocket/core`);
    }
  }
  return { errors, packages: [...packages].sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--metafile');
  const metafile = flag >= 0 ? args[flag + 1] : undefined;
  if (flag >= 0) args.splice(flag, 2);
  if (flag >= 0 && metafile === undefined) {
    console.error('check-deps: --metafile needs a path');
    process.exit(1);
  }
  const root = resolve(args[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));

  let errors;
  if (metafile === undefined) {
    errors = checkDeps(root);
  } else {
    const result = checkBundle(root, metafile);
    errors = result.errors;
    if (result.packages) console.log(`check-deps: bundled packages: ${result.packages.join(', ')}`);
  }
  if (errors.length > 0) {
    for (const e of errors) console.error(`check-deps: ${e}`);
    process.exit(1);
  }
  console.log('check-deps: ok');
}
