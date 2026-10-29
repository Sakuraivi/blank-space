import { createSession } from '../public/core.mjs';
import { buildContext } from './contract.mjs';
import { runCandidate } from './runtime.mjs';

const session = createSession('moment');
session.story = '周末随意走了走，没有安排也很舒服。';
session.focus = '平时总把时间排满，我想留住这次轻松的感觉。';
const context = buildContext({ session, revision: 1 });
const fixture = {
  reflection: { text: '这次没有固定安排的散步让你觉得舒服，你想留住这份轻松。', evidenceIds: ['u_story', 'u_focus'] },
  hypothesis: { text: '你在意的可能包括临时决定下一步的空间，这还需要由你来判断。', evidenceIds: ['u_story', 'u_focus'] },
  question: { text: '这份轻松里，你最想再留一点给自己的是什么？', evidenceIds: ['u_focus'] },
  nextStep: null,
};
const profile = { providerId: 'offline-fixture', modelId: 'no-live-model', instructionChannel: 'instructions', structuredOutput: true };
const adapter = { profile, async generate() { return { status: 'completed', output: fixture }; } };
const valid = await runCandidate({ context, adapter, isCurrent: () => true });
const stale = await runCandidate({ context, adapter, isCurrent: () => false });
const invalid = await runCandidate({ context, adapter: { profile, async generate() { return { status: 'completed', output: { ...fixture, confirmed: true } }; } }, isCurrent: () => true });
console.log(JSON.stringify({ notice: '离线样例：以下文字为预写测试数据，没有调用 AI，也未联网。', valid, stale, invalid }, null, 2));
