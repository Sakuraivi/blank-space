import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TABLES = {
  pilot_requests: {
    key: 'request_id',
    columns: ['request_id', 'session_id', 'digest', 'config_version', 'source_mode', 'provider_id', 'model_id', 'price_version', 'reserved_micros', 'state', 'created_at_ms', 'finished_at_ms', 'outcome', 'prompt_tokens', 'completion_tokens', 'total_tokens'],
  },
  pilot_config: { key: 'id', columns: ['id', 'encrypted_key', 'iv', 'enabled', 'revision', 'invite_hash', 'admin_user_id'] },
};
const hash = value => createHash('sha256').update(value).digest('hex');

export function summarize(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw Error('snapshot_required');
  const tables = {};
  for (const [name, spec] of Object.entries(TABLES)) {
    if (!Array.isArray(snapshot[name])) throw Error(`missing_table:${name}`);
    const seen = new Set();
    const rows = snapshot[name].map(row => {
      if (!row || typeof row !== 'object' || Object.keys(row).sort().join() !== [...spec.columns].sort().join()) throw Error(`schema_mismatch:${name}`);
      if (typeof row[spec.key] !== 'string' || !row[spec.key] || seen.has(row[spec.key])) throw Error(`row_identity_invalid:${name}`);
      seen.add(row[spec.key]);
      const ordered = {};
      for (const column of spec.columns) {
        const value = row[column];
        if (value !== null && typeof value !== 'string' && !Number.isSafeInteger(value)) throw Error(`value_invalid:${name}`);
        ordered[column] = value;
      }
      return ordered;
    }).sort((a, b) => a[spec.key].localeCompare(b[spec.key]));
    tables[name] = { rows: rows.length, sha256: hash(JSON.stringify(rows)) };
  }
  const defaults = snapshot.pilot_requests.filter(row => row.source_mode === 'default');
  const reserved = defaults.reduce((sum, row) => {
    if (!Number.isSafeInteger(row.reserved_micros) || row.reserved_micros < 0) throw Error('invalid_reservation');
    return sum + row.reserved_micros;
  }, 0);
  if (!Number.isSafeInteger(reserved) || defaults.length < 2 || reserved < 100000) throw Error('historical_shared_floor_missing');
  return { tables, defaultCalls: defaults.length, reservedMicros: reserved, remainingCalls: Math.max(0, 18 - defaults.length), remainingBudgetMicros: Math.max(0, 900000 - reserved) };
}

export function verifySnapshots(source, target) {
  const before = summarize(source), after = summarize(target);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('migration_snapshot_mismatch');
  return { matched: true, ...after };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const paths = process.argv.slice(2);
    const [sourcePath, targetPath] = paths;
    if (paths.length !== 2 || !sourcePath || !targetPath) throw Error('usage: npm run verify:migration -- SOURCE.json TARGET.json');
    const source = JSON.parse(await readFile(sourcePath, 'utf8'));
    const target = JSON.parse(await readFile(targetPath, 'utf8'));
    // Output only counts and digests. Never echo row IDs, encrypted fields or data.
    process.stdout.write(`${JSON.stringify(verifySnapshots(source, target), null, 2)}\n`);
  } catch (error) {
    // Parse/file errors may contain input fragments or private paths. Keep CLI errors fixed.
    const message = error instanceof SyntaxError ? 'invalid_snapshot_json'
      : /^(snapshot_required|missing_table:(pilot_requests|pilot_config)|schema_mismatch:(pilot_requests|pilot_config)|row_identity_invalid:(pilot_requests|pilot_config)|value_invalid:(pilot_requests|pilot_config)|invalid_reservation|historical_shared_floor_missing|migration_snapshot_mismatch|usage: npm run verify:migration -- SOURCE\.json TARGET\.json)$/.test(error.message)
        ? error.message : 'snapshot_read_failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
