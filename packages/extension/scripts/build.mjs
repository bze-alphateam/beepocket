import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { zipSync } from 'fflate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const zipPath = join(root, 'beepocket.zip');

rmSync(dist, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: {
    popup: join(root, 'src/popup/main.tsx'),
    'service-worker': join(root, 'src/service-worker.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
});

// Content scripts are classic scripts, not modules.
await build({
  entryPoints: {
    inpage: join(root, 'src/dapp/inpage/main.ts'),
    relay: join(root, 'src/dapp/relay-main.ts'),
    addtoken: join(root, 'src/features/addtoken/content-main.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
});

cpSync(join(root, 'public'), dist, { recursive: true });

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

// Deterministic zip: sorted entries, fixed timestamps, fixed permissions.
const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? '0');
const mtime = new Date(Math.max(epoch * 1000, Date.UTC(1980, 0, 1)));
const files = listFiles(dist)
  .map((full) => relative(dist, full).split(sep).join('/'))
  .sort();
const entries = {};
for (const name of files) {
  entries[name] = [
    readFileSync(join(dist, name)),
    { level: 9, mtime, os: 3, attrs: 0o100644 << 16 },
  ];
}
writeFileSync(zipPath, zipSync(entries));
console.log(`built ${String(files.length)} files -> beepocket.zip`);
