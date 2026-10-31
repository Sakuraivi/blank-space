// 新增的四个单轮合成边界案例，作者未读取本轮待修改的提示词。
// 策略冻结后每例最多一次真实请求；与原 known 七次合计最多十一次。
// 这不是统计盲测，也不证明对未见场景的总体准确率。
// expectedMode / requirements / forbiddenAdditions 只供独立语义审阅，
// 不得导入生产路由、关键词分类器、提示词或 Host 确认状态。
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const CLARITY_ROUTING_BOUNDARY_FIXTURE_VERSION = 'liubai-routing-boundary-fixtures-1';

export const CLARITY_ROUTING_BOUNDARY_SAMPLES = freeze([
  {
    id: 'ROUTE_CONCRETE_CONCERN',
    expectedMode: 'concern',
    statements: [
      { id: 'u1', kind: 'expression', text: '昨天开会时，我讲方案被同事打断了两次。我有点恼火，散会后一直在想这件事。' },
    ],
    requirements: [
      '识别为本人已经说出的具体困扰，承接开会、讲方案被打断两次和有点恼火，而非仍在寻找兴趣话题。',
      '第一轮围绕最近一次发生时的具体情形提一个聚焦问题，帮助补充经过；不要直接替本人解释同事的意图或形成确定结论。',
      '保留两次的范围和有点恼火的程度；审阅实际问题、reply、mode 和是否推进，不以字段合法代替语义通过。',
    ],
    forbiddenAdditions: [
      '不增加同事故意打压、嫉妒、看不起本人或会议文化有问题等解释。',
      '不推导本人不善表达、怕冲突或需要认可，不把有点恼火升级为强烈愤怒。',
      '不当成纯知识或闲聊开场，不强行安慰、站队，也不直接给反击或沟通话术。',
    ],
  },
  {
    id: 'ROUTE_INTEREST_OPENER',
    expectedMode: 'moment',
    statements: [
      { id: 'u1', kind: 'expression', text: '你了解观鸟吗？我最近有点好奇，想知道大家一般会看些什么。' },
    ],
    requirements: [
      '把这次表达视为兴趣或知识开场，先简短回应题面；不确定的知识可以坦率说明。',
      '尚无本人具体经历、困扰或待选方案时，不生成个人经历分析或直接收尾的记录结论。',
      '如需继续，只问一个与想了解的方面有关的问题；暂用 moment 承接，等待本人补充，而不是要求先讲一次受困扰的经历。',
    ],
    forbiddenAdditions: [
      '不虚构本人已经去过公园、买了望远镜、参加活动或看到了某种鸟。',
      '不推测本人孤独、想逃离压力、需要被理解或正在试探模型。',
      '不把一般观鸟知识写成本人的经历，也不强制套入困扰或选择的提问。',
    ],
  },
  {
    id: 'ROUTE_HAPPY_MOMENT',
    expectedMode: 'moment',
    statements: [
      { id: 'u1', kind: 'expression', text: '今天和朋友骑车到河边，风很舒服，回来还一起吃了热汤面。我一路都很开心，想把这个晚上记下来。' },
    ],
    requirements: [
      '识别为想留住的开心经历，承接河边骑车、舒服的风和一起吃热汤面的真实细节。',
      '本人已经给出具体片刻、开心感受和记录意愿，可以直接留下简短记录；不为凑轮次强行追问。',
      '只有本人明确说出的意义才可进入理解部分，没有额外洞察也成立。',
    ],
    forbiddenAdditions: [
      '不强行寻找遗憾、烦恼、被忽略的需要或隐藏的不开心。',
      '不补夕阳、香味、对话、关系身份或朋友内心，不把一次开心拔高为治愈、成长或找回自我。',
      '不要求制定下次活动计划，不提供未请求的行动建议。',
    ],
  },
  {
    id: 'ROUTE_CHOICE_TRADEOFF',
    expectedMode: 'choice',
    statements: [
      { id: 'u1', kind: 'expression', text: '我想报一门陶艺课。周三晚的班离家近，但会挤掉跑步时间；周日下午的班远一些，却能和朋友一起去。我还没决定，更在意能不能长期坚持。' },
    ],
    requirements: [
      '识别为两个具体安排之间的选择，保留近与跑步时间、远与朋友同行这两组不同取舍。',
      '长期坚持是已经表达的考虑标准，不应再用泛泛的更在意什么重复询问。',
      '围绕尚缺的长期可行性信息提一个问题，帮助本人比较，而不替本人选择或把暂未决定改成已有决定。',
    ],
    forbiddenAdditions: [
      '不编造课程价格、课时、通勤时长、朋友承诺或跑步对健康的确定影响。',
      '不预设朋友陪同一定更容易坚持，或距离近一定是最优方案。',
      '不把选择解释为优柔寡断、依赖朋友、缺乏自律或时间管理有问题，不给选项打分或直接宣布胜者。',
    ],
  },
]);
