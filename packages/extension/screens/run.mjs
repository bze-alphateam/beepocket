// `pnpm --filter @beepocket/extension screens [-- <group>...]`: build, then walk the groups.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const groups = process.argv.slice(2).filter((a) => a !== '--');
const run = (cmd, args) => {
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 1);
};

run(process.execPath, ['scripts/build.mjs']);
// A group is a spec file name: `shell` runs screens/shell.spec.ts only.
const files = groups.map((g) => `screens/${g}.spec.ts`);
run('pnpm', ['exec', 'playwright', 'test', '-c', 'screens/playwright.config.ts', ...files]);
