import test from 'node:test';
import assert from 'node:assert/strict';
import { expressionParts, parseVerbatimExpression } from '../public/clarity-expression.mjs';

test('an explicit terminal request keeps M03 material rather than its interaction controls', () => {
  const raw = '今天自己做的面很好吃，我很开心。只想留住这一句，不需要分析或建议。';
  assert.deepEqual(parseVerbatimExpression(raw), { text: '今天自己做的面很好吃，我很开心。' });
  assert.deepEqual(expressionParts(raw), {
    content: '今天自己做的面很好吃，我很开心。',
    controls: [
      { text: '只想留住这一句，', record: true, stop: false },
      { text: '不需要分析或建议。', record: false, stop: true },
    ],
  });
});

test('raw body spans preserve inner newlines, punctuation and quoted requests', () => {
  const text = '朋友说：“不用再问我了。”我听完有点难过。\n\n今天先留在这里，';
  assert.deepEqual(parseVerbatimExpression(`${text}\n只想保留原话。`), { text });
  assert.deepEqual(parseVerbatimExpression('第一行。\r\n第二行，\r\n只想保留原话。'), { text: '第一行。\r\n第二行，' });
});

test('the terminal suffix may combine controls but must include an explicit record request', () => {
  for (const raw of [
    '今天自己做的面很好吃。不需要分析，只想保留原话。',
    '今天自己做的面很好吃。只想保留原话。先到这里吧。',
    '今天自己做的面很好吃。只想保留原话，不用问我。',
  ]) assert.deepEqual(parseVerbatimExpression(raw), { text: '今天自己做的面很好吃。' });
  for (const raw of ['今天自己做的面很好吃。不需要分析。', '今天自己做的面很好吃。不用再问我了。', '今天自己做的面很好吃。先到这里吧。']) {
    assert.equal(parseVerbatimExpression(raw), null);
  }
});

test('a recognized control embedded earlier in the body prevents local recording without rewriting it', () => {
  for (const raw of [
    '今天面很好吃。不要分析。真的很开心。只想保留原话。',
    '今天面很好吃。只想留住这一句。后来又想补一点。只想保留原话。',
  ]) assert.equal(parseVerbatimExpression(raw), null, raw);
  const quoted = '今天面很好吃。朋友说：“不要分析。”真的很开心。';
  assert.deepEqual(parseVerbatimExpression(`${quoted}只想保留原话。`), { text: quoted });
});

test('narrated, quoted, comma and semicolon clauses never become a local record command', () => {
  for (const raw of [
    '朋友说：“只想保留原话。”',
    '“只想保留原话”，是她当时的要求。',
    '朋友说，只想保留原话。',
    '朋友说；只想保留原话。',
    '朋友说：\n只想保留原话。',
    '我只想保留原话里的那份犹豫。',
    '我不需要分析这次失败，只想睡一觉。',
    '今天很开心。只想保留原话。还有另一件事想聊。',
    '今天很开心。只想保留原话，后来又改了主意。',
  ]) assert.equal(parseVerbatimExpression(raw), null, raw);
});

test('nested, unmatched or code quotations conservatively stay on the normal path', () => {
  for (const raw of [
    '朋友说：“她说「只想保留原话」。”\n只想保留原话。',
    '朋友说：“她说“只想保留原话。””\n只想保留原话。',
    '朋友说：“这句话还没说完。\n只想保留原话。',
    '今天记下的原话。”\n只想保留原话。',
    '```\n只想保留原话。',
  ]) assert.equal(parseVerbatimExpression(raw), null, raw);
});

test('an explicit request without body is distinguishable from no explicit request', () => {
  assert.deepEqual(parseVerbatimExpression('只想保留原话。'), { text: '' });
  assert.deepEqual(parseVerbatimExpression('  不需要分析，只想保留原话。  '), { text: '' });
  for (const raw of ['', '  ', null, undefined, 3]) assert.equal(parseVerbatimExpression(raw), null);
});

test('local raw text has no model claim length limit and is never shortened', () => {
  const text = '很长的一段原话'.repeat(100) + '。\n末尾也要留下，';
  assert.ok(text.length > 240);
  assert.deepEqual(parseVerbatimExpression(`${text}\n只想保留原话。`), { text });
});

test('the shared legacy splitter retains its established normal-path behavior', () => {
  for (const raw of ['朋友说：“不用再问我了。”我有点难受。', '“不需要分析或建议”，是她当时的原话。', '我不需要分析这次失败，只想睡一觉。']) {
    assert.deepEqual(expressionParts(raw), { content: raw, controls: [] });
  }
  assert.deepEqual(expressionParts('正文，\n只想保留原话。'), { content: '正文。', controls: [{ text: '只想保留原话。', record: true, stop: false }] });
});
