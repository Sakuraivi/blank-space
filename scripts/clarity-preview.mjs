// Local-only vertical-slice harness. Real mode calls APIs only with a personal
// key entered by the user. --fixture uses labelled synthetic C01 responses.
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { handleApi } from '../server/api.mjs';
import { c01Candidate } from '../ai/fixtures/clarity-c01.mjs';
import { createClarityEvaluation } from './clarity-evaluation.mjs';

const root = resolve(import.meta.dirname, '..'), assets = resolve(root, 'public');
const replay = process.argv.includes('--replay-c01') ? JSON.parse(readFileSync(resolve(root, 'ai/evaluations/2026-10-31-c01.json'), 'utf8')) : null;
const fixture = process.argv.includes('--fixture') || !!replay;
const evaluationFetch = !fixture && (process.argv.includes('--evaluate-c01') || process.argv.includes('--evaluate-core'))
  ? createClarityEvaluation(fetch, { followup: process.argv.includes('--followup'), coreSuite: process.argv.includes('--evaluate-core') }) : null;
const port = Number(process.env.LIUBAI_PREVIEW_PORT ?? (fixture ? 4193 : 4192));
const sqlite = new DatabaseSync(':memory:');
for (const file of readdirSync(resolve(root, 'drizzle')).filter(n => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(resolve(root, 'drizzle', file), 'utf8'));
const DB = { prepare(sql) { let args = []; return { bind(...values) { args = values; return this; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; } }; } };
const env = { DB, ...(fixture ? { LIUBAI_DEFAULT_DEEPSEEK_KEY: 'synthetic-key-for-local-fixture' } : {}) };
let modelCalls = 0;
const fixtureFetch = async (_, options) => {
  modelCalls++;
  await new Promise(resolve => setTimeout(resolve, 150));
  const context = JSON.parse(JSON.parse(options.body).messages[1].content);
  if (replay) {
    const entry = replay.calls[context.statements.length - 1];
    const recorded = entry && JSON.parse(entry.input.messages[1].content);
    if (!recorded || context.statements.some((s, i) => s.text !== recorded.statements[i]?.text)) return Response.json({ error: { code: 'replay_sample_mismatch' } }, { status: 400 });
    return Response.json(entry.output);
  }
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(c01Candidate(context)) } }], usage: { prompt_tokens: 1000, completion_tokens: 300, total_tokens: 1300 } });
};
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (fixture && url.pathname === '/__fixture-count') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ synthetic: true, modelCalls })); return; }
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 100000) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
      const body = Buffer.concat(chunks), controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      const response = await handleApi(new Request(url, { method: req.method, headers: req.headers, signal: controller.signal, ...(body.length ? { body } : {}) }), env, fixture ? { fetchImpl: fixtureFetch, now: () => Date.parse('2026-10-31T00:00:00Z') } : evaluationFetch ? { fetchImpl: evaluationFetch } : {});
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    if (['/admin', '/admin/'].includes(url.pathname)) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('本地独立预览不连接线上共享配置。请在 AI 设置中填写临时个人 Key。'); return; }
    const pathname = ['/', '/clarity', '/clarity/'].includes(url.pathname) ? '/clarity.html' : decodeURIComponent(url.pathname);
    const file = resolve(assets, `.${pathname}`);
    if (!file.startsWith(assets + sep) || !existsSync(file) || file.endsWith('.test.mjs')) { res.writeHead(404); res.end('Not found'); return; }
    let data = readFileSync(file);
    if (fixture && extname(file) === '.html') data = data.toString().replace('<body>', `<body><p class="help-note" style="max-width:624px;margin:16px auto;font-size:14px">${replay ? '验收回放：合成案例的真实模型响应，已应用本轮选段修复。当前没有实时调用模型。' : '联调演示：使用虚构的朋友取消约定样例，回复不是由真实模型生成。'}</p>`);
    // An explicit QA-only text-size fixture; never shipped in the public assets.
    if (fixture && url.searchParams.get('textSize') === '200' && extname(file) === '.html') data = data.toString().replace('</head>', '<style>:root{font-size:38px}</style></head>');
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { if (!res.headersSent) res.writeHead(500); res.end('Local preview unavailable'); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`${fixture ? 'Synthetic fixture' : 'Personal-key preview'}: http://localhost:${port}/\n`));
