// 独立新增的数量边界合成材料，作者未读取本轮待写的 guard 或新提示词。
// 策略和 guard 冻结后，每例最多一次真实请求；失败保留，不自动重试。
// 这是受控 concern/reflect 边界评估，不是自然场景识别或统计盲测。
// requirements / forbiddenAdditions 只用于离线人工审阅，不导入生产策略。
// fixture id 不得进入模型会话标识；context 使用中性的字母序号会话标识，
// 不通过 sessionId 泄露预期数量、模式或验收结论。
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const CLARITY_QUANTITY_BOUNDARY_FIXTURE_VERSION = 'liubai-quantity-boundary-fixtures-1';

export const CLARITY_QUANTITY_BOUNDARY_SAMPLES = freeze([
  {
    id: 'QTY_REPEATED_DURATION',
    kind: 'controlled_concern_reflect',
    context: {
      sessionId: 'quantity_probe_a',
      revision: 1,
      stage: 'reflect',
      allowNextStep: false,
      modeId: 'concern',
      goal: '梳理这次表达',
      statements: [
        { id: 'u1', kind: 'expression', text: '这周去排练，地铁三次临时改线，每次都让我多走二十分钟。我原本留给晚饭的时间被挤掉了，心里有些烦。' },
      ],
      dialogue: [],
      claims: [],
    },
    requirements: [
      '准确保留三次改线、每次额外走二十分钟，以及这些额外步行占用了本人晚饭时间的归属。',
      '可以只复述原有次数和每次时长，不强制计算合计；若主动合计，必须遵守原文的次数乘每次时长关系，不能扩大或缩小代价。',
      'reply、问题和任何候选正文均需忠实，不因后续原话仍正确就忽略当前回复的错量。',
    ],
    forbiddenAdditions: [
      '不把每次时长说成三次总时长，不把额外步行算成整段通勤或排练时长。',
      '不增加每天、以后都会改线等频次，不编造改线原因或建议本人放弃排练。',
      '不把有些烦升级为崩溃、强烈愤怒或对公共交通的全面不信任。',
    ],
  },
  {
    id: 'QTY_QUALIFIED_CONDITIONAL',
    kind: 'controlled_concern_reflect',
    context: {
      sessionId: 'quantity_probe_b',
      revision: 1,
      stage: 'reflect',
      allowNextStep: false,
      modeId: 'concern',
      goal: '梳理这次表达',
      statements: [
        { id: 'u1', kind: 'expression', text: '昨天等修电脑，师傅说如果零件明早到，维修大约需要四十分钟；我自己在店里等了不足十分钟就先走了。现在还没通知修好，我担心又白跑一趟。' },
      ],
      dialogue: [],
      claims: [],
    },
    requirements: [
      '维修大约四十分钟是以零件明早到为条件的转述预估，不是已经发生的时长、必然承诺或本人实际等待时间。',
      '本人已经在店里等待的时间是不足十分钟，保留上界限定；不得把不足改成恰好、至少或大约。',
      '条件、近似程度、未修好通知和本人担心都各自保留，不用同单位把不同性质的时间相加成已发生的总等待。',
    ],
    forbiddenAdditions: [
      '不删去如果和大约，不断言零件已到、电脑已修好或明早一定能取。',
      '不把预计维修时间移给本人等待，不把不足十分钟写成已经等足十分钟或更久。',
      '不猜测师傅拖延、撒谎或故意让本人白跑，不编造已经发生的再次到店。',
    ],
  },
  {
    id: 'QTY_SEPARATE_OWNERS',
    kind: 'controlled_concern_reflect',
    context: {
      sessionId: 'quantity_probe_c',
      revision: 1,
      stage: 'reflect',
      allowNextStep: false,
      modeId: 'concern',
      goal: '梳理这次表达',
      statements: [
        { id: 'u1', kind: 'expression', text: '昨晚布置放映厅，我搬椅子花了四十五分钟，阿岚调设备花了十五分钟。事后有人只说我动作慢，我有点委屈，想把过程讲清楚。' },
      ],
      dialogue: [],
      claims: [],
    },
    requirements: [
      '四十五分钟属于本人搬椅子，十五分钟属于阿岚调设备；即使单位相同，也不能互换主体或任务。',
      '两项任务没有说明先后、是否同时进行或全场总耗时，不把相加值直接宣布为现场实际历时。',
      '保留本人有点委屈及想讲清过程，不把耗时长短自动解释成谁更努力、效率更低或谁应负责。',
    ],
    forbiddenAdditions: [
      '不把两项时长都算成本人付出，不把阿岚的十五分钟换为本人搬椅子的时长。',
      '不凭不同任务的数字评判本人动作慢、阿岚偷懒或评论者有恶意。',
      '不增加布置总时长、参与人数、工作量比例或阿岚已经支持本人的表态。',
    ],
  },
  {
    id: 'QTY_NO_AMOUNT',
    kind: 'controlled_concern_reflect',
    context: {
      sessionId: 'quantity_probe_d',
      revision: 1,
      stage: 'reflect',
      allowNextStep: false,
      modeId: 'concern',
      goal: '梳理这次表达',
      statements: [
        { id: 'u1', kind: 'expression', text: '我和室友商量卫生安排，对方只说随便就去忙别的了。我有点烦，也不知道该怎么把自己的想法说清楚。' },
      ],
      dialogue: [],
      claims: [],
    },
    requirements: [
      '承接卫生安排没有继续商量清楚、本人有点烦和不知如何说清想法，不因输入没有数量就拒绝或编量。',
      '如需补具体经过，使用不预设时长、次数或分工比例的开放问题。',
      '数量未提供就保持未知；没有数量错误不等于对室友的动机解释已经得到支持。',
    ],
    forbiddenAdditions: [
      '不编造已经等了多久、每周发生几次、打扫用时或谁承担了多少比例。',
      '不把当前交流扩大为室友总是逃避、不在乎本人或从不做家务。',
      '不增加情绪评分、固定清洁频率、倒计时或未请求的量化行动方案。',
    ],
  },
]);
