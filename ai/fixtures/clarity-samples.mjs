import { inputs } from './clarity-c01.mjs';
const concern = [inputs[0], inputs[1], '不是失落，是生气。我能理解临时有事，但她都没有主动说下次什么时候，好像只有我在等。又怕说了显得我在逼她。', inputs[3]];

// Synthetic inputs, shared by controlled evaluation and deterministic tests.
export const CORE_SAMPLES = Object.freeze({
  C01: concern,
  C01_READY: [concern.join('\n')],
  M01: ['周末和朋友沿着河边散步，没有赶着走完哪条路线。走累了，就在长椅上坐了一会儿。', '最舒服的是不用一直找话说，安静坐着也不尴尬。我只想把这种有人陪着、又不需要表现的感觉留下来。'],
  M02: ['今天jun说自己是笨蛋，我笑了。就想留住这句玩笑，不用再问我了。'],
  M03: ['今天自己做的面很好吃，我很开心。只想留住这一句，不需要分析或建议。'],
  D01: ['想报一个周末陶艺班，六周，每周六三小时。我一直想学，但是最近工作很累，又怕不报会一直拖。', '至少得有一天完全不用出门。星期天一般要陪家人。学陶艺主要想动手做点东西，不是为了学得多专业。', '好像有单次体验课，但我还没问价格和时间。如果有合适时间，我想先去一次。'],
  D04: ['想报六周的陶艺班，但我最近很累，需要留出周末休息。', '我决定先不报了，等忙完这阵再看。现在只想把这个决定记下来，不用劝我开始。'],
  C06: ['很烦。', '不想继续说了，先到这里吧。'],
  C07: ['最近总觉得有点烦，但不知道为什么。', '不知道。', '还是不知道，不想再回答了。'],
});

export function sampleForStatements(statements) {
  if (!Array.isArray(statements) || !statements.length) return null;
  for (const [id, values] of Object.entries(CORE_SAMPLES)) {
    if (statements[0]?.text === values[0] && statements.every((s, i) => s.text === values[i])) return id;
  }
  return null;
}
