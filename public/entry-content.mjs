// Presentation content only. This module owns no provider, session or storage.
// Only text a user chooses and submits may later enter their story context.
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const ENTRY_TOPICS = freeze([
  { modeId: 'moment', title: '留住一个片刻', description: '把一个开心或平静的瞬间收起来。' },
  { modeId: 'concern', title: '理一理心事', description: '从最近放在心上的一件事说起。' },
  { modeId: 'choice', title: '想清一个选择', description: '把选项和在意的事慢慢写清楚。' },
]);

export const STORY_STARTERS = freeze({
  moment: [
    { label: '今天有一幕……', text: '今天有一幕……' },
    { label: '当时，我注意到……', text: '当时，我注意到……' },
    { label: '我想记住它，因为……', text: '我想记住它，因为……' },
  ],
  concern: [
    { label: '最近让我挂心的是……', text: '最近让我挂心的是……' },
    { label: '事情是从这里开始的……', text: '事情是从这里开始的……' },
    { label: '我最想先说的是……', text: '我最想先说的是……' },
  ],
  choice: [
    { label: '我正在考虑的选项有……', text: '我正在考虑的选项有……' },
    { label: '让我拿不准的一点是……', text: '让我拿不准的一点是……' },
    { label: '对我来说，比较重要的是……', text: '对我来说，比较重要的是……' },
  ],
});

export const STORY_PLACEHOLDERS = freeze({
  moment: '可以从“今天有一幕……”开始。',
  concern: '可以先写一件最近常想起的事。',
  choice: '可以先写下这个选择，或一个让你犹豫的地方。',
});

export const EXAMPLE_LETTER = freeze({
  title: '把周末留慢一点',
  sections: [
    { label: '这件小事', text: '周末和朋友沿着河边散步。没有赶着走完哪条路线，走累了，就在长椅上坐了一会儿。' },
    { label: '当时的感受', text: '我觉得很轻松。有人陪着，不必一直找话说，也不用赶去下一个地方。' },
    { label: '想留给自己的一句话', text: '有些时间可以不安排得那么满，慢慢走一会儿也很好。' },
  ],
  optionalNextStep: { label: '一个可选的小行动', text: '这周留一个没有安排的晚上，看看自己当时想做什么。也可以只把这个片刻记住。' },
});
