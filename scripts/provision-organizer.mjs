// Explicit owner-only provisioning. Secrets travel to Wrangler over stdin;
// plaintext login material is written outside the repository, never stdout.
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, relative, sep } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const privateDir = process.argv[2];
if (!privateDir || !isAbsolute(privateDir)) throw Error('absolute_private_directory_required');
const target = resolve(privateDir);
const relation = relative(root, target);
if (relation !== '..' && !relation.startsWith('..' + sep)) throw Error('private_directory_must_be_outside_repository');
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const args = ['--config', resolve(root, 'wrangler.standalone.jsonc')];
function run(command, input) {
  const result = spawnSync(process.execPath, [wrangler, ...command, ...args], {
    cwd: root, input, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw Error('cloudflare_operation_failed');
  return result.stdout;
}
const raw = run(['secret', 'list']);
const start = raw.search(/\[\s*(?:\]|\{)/), end = raw.lastIndexOf(']');
if (start < 0 || end < start) throw Error('secret_metadata_unavailable');
const names = new Set(JSON.parse(raw.slice(start, end + 1)).map(item => item.name));
const authName = 'LIUBAI_ADMIN_PASSWORD_HASH', cryptoName = 'LIUBAI_SECRET_KEY';
const backupPath = resolve(target, 'organizer-bootstrap.json');
if (names.has(authName) && !existsSync(backupPath)) throw Error('existing_admin_preserved_no_local_login_material');
mkdirSync(target, { recursive: true, mode: 0o700 });
if (process.platform === 'win32') {
  const identity = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
  const sid = identity.match(/S-1-5-\d+(?:-\d+)+/)?.[0];
  if (!sid) throw Error('local_identity_unavailable');
  execFileSync('icacls', [target, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { stdio: 'pipe' });
}
const backup = existsSync(backupPath) ? JSON.parse(readFileSync(backupPath, 'utf8')) : {};
const secrets = {};
if (!names.has(authName)) {
  backup.adminPassword ??= randomBytes(32).toString('base64url');
  secrets[authName] = createHash('sha256').update(backup.adminPassword).digest('hex');
}
if (!names.has(cryptoName)) {
  backup.encryptionMaster ??= randomBytes(32).toString('base64');
  secrets[cryptoName] = backup.encryptionMaster;
}
backup.url = 'https://blank.sakura.observer/admin';
writeFileSync(backupPath, JSON.stringify(backup, null, 2) + '\n', { mode: 0o600 });
if (Object.keys(secrets).length) run(['secret', 'bulk'], JSON.stringify(secrets));
if (!backup.adminPassword) throw Error('login_material_unavailable');
const loginPath = resolve(target, '管理员登录资料.txt');
writeFileSync(loginPath, `留白 · 组织者管理\n\n入口：${backup.url}\n管理口令：${backup.adminPassword}\n\n此文件仅保存在你的电脑。请勿上传到网站源码或公开分享。\n首次登录后在页面配置真实模型Key；本次没有自动启用共享调用。\n`, { mode: 0o600 });
process.stdout.write(JSON.stringify({ provisioned: true, secretsCreated: Object.keys(secrets), loginFile: loginPath }) + '\n');
