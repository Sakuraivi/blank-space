import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// Local bundling only. No resource creation, publication or DNS change.
execFileSync(process.execPath, [
  resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'deploy',
  '--config', resolve(root, 'wrangler.standalone.jsonc'),
  '--dry-run', '--outdir', resolve(root, 'dist/standalone'),
], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
