// Shared interaction syntax only. These controls never establish a feeling,
// interpretation, relationship, or model-generated conclusion as true.
const controlCore = part => part.trim().replace(/[。！？!?；;，,]$/u, '').trim();
function interactionControl(part) {
  const core = controlCore(part);
  const record = /^(?:我)?(?:只想|只要|就想|就要|就)(?:把)?(?:留住|留下|保留|记录|记下)(?:这一句|这句话|这句|原话|这一句话)(?:就好|就行|即可)?$/u.test(core);
  const stop = /^(?:(?:我)?(?:不想|不愿意)(?:再|继续)?(?:说|聊|回答)(?:了)?|(?:不用|不要|不必)(?:再|继续)?(?:追问|问我|问了)(?:了)?|(?:先)?(?:到这里|这样)(?:吧|就好|就行)?|(?:我)?(?:不需要|不用|不要)(?:再)?(?:分析|建议|分析或建议|分析和建议))$/u.test(core);
  return record || stop ? { record, stop } : null;
}

// Preserve the established AI-path splitter, including its historical trailing
// comma normalization. Local verbatim recording deliberately does not use its
// reconstructed content string.
export function expressionParts(value) {
  const chunks = []; let chunk = '', quote = null;
  const pairs = { '“': '”', '「': '」', '『': '』', '"': '"' };
  for (const ch of value) {
    chunk += ch;
    if (quote) { if (ch === quote) quote = null; }
    else if (pairs[ch]) quote = pairs[ch];
    else if (/[。！？!?；;，,\n]/u.test(ch)) { chunks.push(chunk); chunk = ''; }
  }
  if (chunk) chunks.push(chunk);
  const controls = [], content = [];
  for (const part of chunks) {
    const control = interactionControl(part);
    if (control) controls.push({ text: part, ...control });
    else content.push(part);
  }
  return { content: content.join('').trim().replace(/[，,；;]$/u, '。'), controls };
}

function verbatimChunks(value) {
  // Ambiguous quotation stays on the normal path. In particular, never treat
  // a command inside a malformed/nested quote or code block as user control.
  if (value.includes('`')) return null;
  const pairs = { '“': '”', '「': '」', '『': '』', '"': '"', '‘': '’', "'": "'" };
  const closing = new Set(Object.values(pairs));
  const chunks = []; let start = 0, quote = null;
  for (let index = 0; index < value.length; index++) {
    const ch = value[index];
    if (quote) {
      if (ch === quote) quote = null;
      else if (pairs[ch] || closing.has(ch)) return null;
    } else if (pairs[ch]) quote = pairs[ch];
    else if (closing.has(ch)) return null;
    else if (/[。！？!?；;，,\n]/u.test(ch)) {
      chunks.push({ start, text: value.slice(start, index + 1) }); start = index + 1;
    }
  }
  if (quote) return null;
  if (start < value.length) chunks.push({ start, text: value.slice(start) });
  return chunks.filter(chunk => chunk.text.trim());
}

// A match identifies an explicit terminal request to keep the preceding raw
// text. It does not decide whether the caller's session can safely accept it.
// null = not applicable; { text: '' } = explicit request missing its material.
export function parseVerbatimExpression(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const chunks = verbatimChunks(value);
  if (!chunks?.length) return null;
  let suffixStart = chunks.length, hasRecord = false;
  for (let index = chunks.length - 1; index >= 0; index--) {
    const control = interactionControl(chunks[index].text);
    if (!control) break;
    suffixStart = index; hasRecord ||= control.record;
  }
  if (!hasRecord) return null;
  // Controls must form one suffix. Never copy an earlier control into the raw
  // record, or remove it by reconstructing a different body.
  if (chunks.slice(0, suffixStart).some(chunk => interactionControl(chunk.text))) return null;
  const start = chunks[suffixStart].start;
  // A comma/semicolon can introduce reported speech. A fresh sentence or line
  // is required before the whole control suffix, not before each control.
  if (start && !/[。！？!?\n]/u.test(value[start - 1])) return null;
  const prefix = value.slice(0, start);
  if (/[：:]\s*$/u.test(prefix)) return null;
  return { text: prefix.trim() };
}
