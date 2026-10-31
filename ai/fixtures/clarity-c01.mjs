// Synthetic design sample. This is test data, never a production model fallback.
export const inputs = [
  '最近约了两次朋友，她都在当天取消。我开始觉得她是不是不想见我了，又怕是我太在意。现在一想到还要不要再约她，就很烦。',
  '她说临时加班，发了个抱歉的表情。上一次是家里有事。后来都没说下次什么时候。那两个周六我都专门空出来了。',
  '我能理解临时有事。更难受的是，她都没有主动说下次什么时候，好像只有我在等。但又怕说了显得我在逼她。',
  '我不是要她每次都有空。取消了的话，希望她能主动提一个新时间。如果她现在没空，也直接说，我就不用一直留着周末。',
];
const claim = (type, text, evidenceIds, supersedes = [], derivation = 'inferred') => ({ type, text, evidenceIds, supersedes, derivation });
export function c01Candidate(context) {
  const sources = context.statements.filter(s => s.kind !== 'request').map(s => s.id);
  const previous = context.claims.filter(c => !['edited', 'confirmed'].includes(c.status));
  const base = { modeId: 'concern', goal: '弄清一直等待的困扰和自己的期待', title: '想见面，也不想一直等着', reply: '', question: null, claims: [], finish: false };
  if (context.allowNextStep) return { ...base, reply: '这句话把期待说清楚，也给对方留下了说明近况的空间。你可以改成自己的口吻。', finish: true,
    claims: [claim('action', '我还是想和你见面。要不这次你看看，哪天比较有把握？如果最近实在没空，也直接告诉我，我就先安排自己的周末。', sources)] };
  const n = context.dialogue.length;
  if (n === 0 && context.stage === 'reflect') return { ...base, reply: '你既在猜她的想法，又在怀疑自己的在意。两头都没有答案，确实容易越想越烦。我们先看看实际发生了什么。',
    question: { text: '最近一次取消后，你们是怎么聊的？', target: 'event', evidenceIds: sources },
    claims: [claim('thought', '两次约定被取消，让你猜测她是否不想见你；目前还不能确定她的想法。', sources)] };
  if (n === 1 && context.stage === 'reflect') return { ...base, reply: '两个周六都特意空出来了，这份期待值得被认真对待。这里缠在一起的，可能有计划落空的失落，也有没有后续安排的不确定。',
    question: { text: '哪一部分更让你难受？也可以是别的。', target: 'need', evidenceIds: sources },
    claims: [claim('event', '两个周六都专门留给见面，两次取消后都没有提下次什么时候。', sources, previous.map(c => c.id), 'stated')] };
  if (n === 2 && context.stage === 'reflect') return { ...base, reply: '一边想知道她也愿意见你，一边又担心一开口就像在催她；这让“要不要再约”变得很难。我们可以把你的期待说得具体一点。',
    question: { text: '怎样的安排，会让你觉得不再只是自己在等？', target: 'need', evidenceIds: sources },
    claims: [claim('need', '能理解临时有事，真正难受的是没有下一次安排；想开口又怕像在逼她。', sources)] };
  return { ...base, reply: '我们把已经说清楚的期待留下，对她想法的猜测先保留为未知。', finish: true, claims: [
    claim('event', '两次都为见面留出了周六，取消后却没有重约。你开始猜她是不是不想见你；想问清楚，又怕显得在催。计划落空和关系里的不确定，叠在了一起。', sources, previous.filter(c => ['event', 'thought', 'feeling'].includes(c.type)).map(c => c.id)),
    claim('insight', '能体谅临时有事，也可以希望安排有回应。\n\n你期待取消后她能主动重约；如果暂时没空，明确说一声，你就不用一直为一个未定的约定留着周末。', sources, previous.filter(c => !['event', 'thought', 'feeling', 'unknown'].includes(c.type)).map(c => c.id)),
    claim('unknown', '她是否不想见你，目前仍不知道。眼下更能确认的是：她是否愿意把下一次安排说清楚。你还没有决定要不要开口，这个决定可以先留着。', sources, previous.filter(c => c.type === 'unknown').map(c => c.id)),
  ] };
}
