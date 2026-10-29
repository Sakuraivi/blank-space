export const MODES = [
  { id: 'moment', label: '开心时刻', description: '留住一个想记下的片刻。', opening: '最近有什么让你想记住的小事？', focusPrompt: '这个片刻里，你最想留下什么？', questions: [
    { id: 'moment_scene', label: '具体片段', prompt: '当时发生了什么？', placeholder: '写下你记得的一个片段' },
    { id: 'moment_feeling', label: '感受与在意', prompt: '你有什么感受，或什么让你在意？', placeholder: '用自己的话记录' },
    { id: 'moment_next', label: '接下来', prompt: '你想为这个片刻做点什么吗？也可以只是把它记下来。', placeholder: '可以留空' }
  ] },
  { id: 'concern', label: '心事', description: '给心里的一件事一点空间。', opening: '有什么事此刻在你心里？', focusPrompt: '这件事里，什么最值得你先放在这里？', questions: [
    { id: 'concern_scene', label: '具体片段', prompt: '有没有一个具体的片段想说？', placeholder: '写下发生的事' },
    { id: 'concern_feeling', label: '感受与在意', prompt: '你有什么感受，或什么让你在意？', placeholder: '用自己的话记录' },
    { id: 'concern_next', label: '接下来', prompt: '如果愿意，有什么小事可以尝试？也可以先不做决定。', placeholder: '可以留空' }
  ] },
  { id: 'choice', label: '小选择', description: '把面前的选择写清楚。', opening: '你正在考虑什么选择？', focusPrompt: '面对这个选择，你最在意什么？', questions: [
    { id: 'choice_scene', label: '具体片段', prompt: '现在有哪些具体的情况或选项？', placeholder: '写下你知道的情况' },
    { id: 'choice_feeling', label: '感受与在意', prompt: '你有什么感受，或哪些事对你重要？', placeholder: '用自己的话记录' },
    { id: 'choice_next', label: '接下来', prompt: '你想怎样继续了解或考虑？也可以暂时不选。', placeholder: '可以留空' }
  ] }
];
export const CARDS = [
  { id: 'pause', name: '留白', caption: '给自己一点空间', prompt: '看见这张卡，你想起什么？', art: 'pause' },
  { id: 'glow', name: '微光', caption: '留意细小的光亮', prompt: '有什么细节浮现在你心里？', art: 'glow' },
  { id: 'connect', name: '连接', caption: '看看彼此的联系', prompt: '你想到什么样的联系？', art: 'connect' },
  { id: 'distance', name: '距离', caption: '感受各自的位置', prompt: '距离让你想到什么？', art: 'distance' },
  { id: 'turn', name: '转向', caption: '换一个角度看看', prompt: '有什么不同的角度浮现？', art: 'turn' },
  { id: 'step', name: '一步', caption: '从眼前的一步开始', prompt: '这张卡让你想到什么？', art: 'step' }
];
const modeFor = id => MODES.find(mode => mode.id === id);
const newId = () => globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function createSession(modeId = 'moment') {
  if (!modeFor(modeId)) throw new RangeError('Unknown mode');
  return { id: newId(), modeId, createdAt: new Date().toISOString(), story: '', focus: '', cardId: null, cardReflection: '', answers: {}, review: null, confirmed: false };
}
export function makeReview(session) {
  const mode = modeFor(session?.modeId);
  if (!mode) throw new RangeError('Unknown mode');
  const sections = [];
  const add = (id, label, text, source) => {
    if (typeof text === 'string' && text.trim()) sections.push({ id, label, text, source });
  };
  add('story', '这件事', session.story, '你写下的故事');
  add('focus', '此刻在意', session.focus, '你写下的关注点');
  add('cardReflection', '卡片联想', session.cardReflection, '你写下的卡片联想');
  for (const question of mode.questions) add(question.id, question.label, session.answers?.[question.id], `你对「${question.label}」的回答`);
  return { title: `${mode.label}的记录`, sections };
}
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stringWithin = (value, max) => typeof value === 'string' && value.length <= max;
const MAX_TEXT = 20000;
const MAX_RECORD = 160000;
export function validateSavedRecord(value) {
  if (!isObject(value) || value.confirmed !== true) return null;
  const mode = modeFor(value.modeId);
  if (!mode || !stringWithin(value.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(value.id)) return null;
  if (!stringWithin(value.createdAt, 40) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) return null;
  if (![value.story, value.focus, value.cardReflection].every(v => stringWithin(v, MAX_TEXT))) return null;
  if (value.cardId !== null && !CARDS.some(card => card.id === value.cardId)) return null;
  if (!isObject(value.answers) || !isObject(value.review) || !stringWithin(value.review.title, 200) || !Array.isArray(value.review.sections) || value.review.sections.length > 6) return null;
  const knownIds = new Set(mode.questions.map(question => question.id));
  const answerEntries = Object.entries(value.answers);
  if (answerEntries.length > knownIds.size || answerEntries.some(([key, val]) => !knownIds.has(key) || !stringWithin(val, MAX_TEXT))) return null;
  const answers = Object.fromEntries(answerEntries);
  const sections = [];
  for (const section of value.review.sections) {
    if (!isObject(section) || !stringWithin(section.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(section.id) || !stringWithin(section.label, 200) || !stringWithin(section.text, MAX_TEXT) || !stringWithin(section.source, 200)) return null;
    sections.push({ id: section.id, label: section.label, text: section.text, source: section.source });
  }
  const record = { id: value.id, modeId: value.modeId, createdAt: value.createdAt, story: value.story, focus: value.focus, cardId: value.cardId, cardReflection: value.cardReflection, answers, review: { title: value.review.title, sections }, confirmed: true };
  if (JSON.stringify(record).length > MAX_RECORD) return null;
  return record;
}

export function shouldWarnBeforeUnload(session) {
  return Boolean(session && !session.confirmed && (session.story?.trim() || session.review));
}
