// 独立六例在审校策略e3ef58e冻结后读取并仅映射接口；不是统计盲测。
// 仅input进入模型，expectedFindings/reviewReasons只用于独立语义复核。
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const SEMANTIC_AUDIT_FRESH_SAMPLES=freeze([
  {
    "id": "AUDIT_DILEMMA_OMISSION",
    "input": {
      "context": {
        "sessionId": "audit_probe_a",
        "revision": 1,
        "stage": "review",
        "allowNextStep": false,
        "modeId": "concern",
        "goal": "理清周末休息和陪爸爸的安排",
        "statements": [
          {
            "id": "u1",
            "kind": "expression",
            "text": "这周末我想在家休息，但爸爸盼我回去吃饭。我想把自己的需要说清楚，又怕他觉得我不愿陪他。"
          }
        ],
        "dialogue": [],
        "claims": []
      },
      "candidate": {
        "modeId": "concern",
        "goal": "理清周末的休息需要",
        "reply": "你想把周末的休息时间留给自己，这份需要已经很清楚。",
        "question": null,
        "claims": [
          {
            "type": "event",
            "text": "这周末我想在家休息，但爸爸盼我回去吃饭。我想把自己的需要说清楚，又怕他觉得我不愿陪他。",
            "evidenceIds": [
              "u1"
            ],
            "derivation": "stated",
            "supersedes": []
          },
          {
            "type": "insight",
            "text": "我想把需要休息这件事说清楚。",
            "evidenceIds": [
              "u1"
            ],
            "derivation": "inferred",
            "supersedes": []
          }
        ],
        "finish": true,
        "title": "周末想留给自己休息"
      },
      "task": "review"
    },
    "expectedFindings": [
      "missing_dilemma_link"
    ],
    "reviewReasons": [
      "这是 review 收尾整体，不是要求 reflect 每轮重复顾虑；原话明确并存想表达休息需要与怕爸爸误解不愿陪伴。",
      "event 只是逐字保留来源，reply 和候选理解均只留下休息需要，没有连起怕被误解这一侧，存在有材料的两难未被整理。",
      "不应据此补写爸爸一定失望或本人已决定拒绝；这组期望只指缺少两难关联，不把缺陷夸大为确定性读心。"
    ]
  },
  {
    "id": "AUDIT_MOMENT_NO_DILEMMA",
    "input": {
      "context": {
        "sessionId": "audit_probe_b",
        "revision": 1,
        "stage": "review",
        "allowNextStep": false,
        "modeId": "moment",
        "goal": "留住午后喝茶的片刻",
        "statements": [
          {
            "id": "u1",
            "kind": "expression",
            "text": "今天午后我坐在阳台喝茶，雨声很轻，我觉得很舒服。只想把这个片刻记下来，不用分析。"
          }
        ],
        "dialogue": [],
        "claims": []
      },
      "candidate": {
        "modeId": "moment",
        "goal": "留住午后喝茶的片刻",
        "reply": "好，把这阵雨声和喝茶时的舒服留在这里。",
        "question": null,
        "claims": [
          {
            "type": "event",
            "text": "今天午后我坐在阳台喝茶，雨声很轻，我觉得很舒服。",
            "evidenceIds": [
              "u1"
            ],
            "derivation": "stated",
            "supersedes": []
          }
        ],
        "finish": true,
        "title": "阳台喝茶时的轻雨声"
      },
      "task": "review"
    },
    "expectedFindings": [],
    "reviewReasons": [
      "review 场景明确只想记录舒服片刻且不分析，来源没有并存两难，不能为满足分析模板硬造第二份顾虑。",
      "候选忠实留下原话细节，不添加心理意义，也没有强行追问；缺少 insight 或 unknown 本身不应触发 missing_dilemma_link。",
      "本例同样没有需要纠正的引导问题或未回答的知识题面。"
    ]
  },
  {
    "id": "AUDIT_CHOICE_LEADING",
    "input": {
      "context": {
        "sessionId": "audit_probe_c",
        "revision": 1,
        "stage": "reflect",
        "allowNextStep": false,
        "modeId": "choice",
        "goal": "比较两种画画安排",
        "statements": [
          {
            "id": "u1",
            "kind": "expression",
            "text": "我在选和同学合租工作室还是在家画画。工作室能交流但要配合开门时间，在家方便却容易被家务打断。我更在意能不能稳定画下去。"
          }
        ],
        "dialogue": [],
        "claims": []
      },
      "candidate": {
        "modeId": "choice",
        "goal": "比较两种安排对稳定画画的影响",
        "reply": "工作室能交流但受开门时间约束，在家方便又会被家务打断，你想比较怎样才能稳定画下去。",
        "question": {
          "text": "你以前是不是只有和别人一起画，才更容易坚持下来？",
          "target": "need",
          "evidenceIds": [
            "u1"
          ]
        },
        "claims": [],
        "finish": false,
        "title": "在工作室还是在家画画"
      },
      "task": "reflect"
    },
    "expectedFindings": [
      "leading_question"
    ],
    "reviewReasons": [
      "交流、时间约束和家务打断都是来源条件，但没有说同行是本人持续画画的必要原因。",
      "只有与才把问题收窄到证明陪同有利的解释，即使可回答不是，也不等于问题已经开放容纳其它实际限制。",
      "这是 reflect 的问题方向缺陷，不应同时因尚未收尾而强报 missing_dilemma_link，也不需要审校器替本人选择地点。"
    ]
  },
  {
    "id": "AUDIT_CHOICE_FACT_CONFIRMATION",
    "input": {
      "context": {
        "sessionId": "audit_probe_d",
        "revision": 2,
        "stage": "reflect",
        "allowNextStep": false,
        "modeId": "choice",
        "goal": "比较两种读书小组的实际安排",
        "statements": [
          {
            "id": "u1",
            "kind": "expression",
            "text": "我在选线上或线下的读书小组。线上不用出门，线下更容易让我专注。"
          },
          {
            "id": "u2",
            "kind": "expression",
            "text": "我更在意下班后能不能赶上，线下通知只写周四晚上，还不知道具体几点开始。"
          }
        ],
        "dialogue": [
          {
            "question": "目前最影响你选择的实际条件是什么？",
            "answerId": "u2"
          }
        ],
        "claims": []
      },
      "candidate": {
        "modeId": "choice",
        "goal": "厘清下班后能否参加的时间条件",
        "reply": "下班后能否赶上是你已经说清的实际条件，线下具体的开始时间还未知。",
        "question": {
          "text": "关于线下开始的具体时间，现在有没有可以核对的信息？没有也可以暂时留作未知。",
          "target": "unknown",
          "evidenceIds": [
            "u2"
          ]
        },
        "claims": [],
        "finish": false,
        "title": "读书小组的参加时间"
      },
      "task": "reflect"
    },
    "expectedFindings": [],
    "reviewReasons": [
      "问题从已经明确的赶上活动标准细化到同一实际缺口的事实核对，不是重新要求本人提供心理原因。",
      "有没有信息允许没有或不知道，不预设线下更好、某种参与方式能保证坚持，也没有要求立即去查或必须得出答案。",
      "这种开放或可否定的事实确认不应仅因出现有没有、已知选项或时间条件就被判 leading_question；reflect 也不要求先补出两难分析。"
    ]
  },
  {
    "id": "AUDIT_KNOWLEDGE_DEFERRED",
    "input": {
      "context": {
        "sessionId": "audit_probe_e",
        "revision": 1,
        "stage": "reflect",
        "allowNextStep": false,
        "modeId": "auto",
        "goal": null,
        "statements": [
          {
            "id": "u1",
            "kind": "expression",
            "text": "我想知道短篇小说里第一人称和第三人称叙述有什么区别，先说清最基本的差别就好，不用推荐书。"
          }
        ],
        "dialogue": [],
        "claims": []
      },
      "candidate": {
        "modeId": "moment",
        "goal": "承接对小说叙述视角的好奇",
        "reply": "你关心的是叙述角度的基本差别，不是书单。",
        "question": {
          "text": "你更想从代入感还是信息范围聊起？",
          "target": "unknown",
          "evidenceIds": [
            "u1"
          ]
        },
        "claims": [],
        "finish": false,
        "title": "小说叙述视角的基本差别"
      },
      "task": "knowledge"
    },
    "expectedFindings": [
      "unanswered_explicit_request"
    ],
    "reviewReasons": [
      "本人已经明确问两种叙述的最基本差别，候选只复述这个目的，没有给出简短差别或诚实的不确定说明。",
      "相关知识角度的菜单不能替代题面回答；这里主要应报 unanswered_explicit_request，而不是因为有两个知识角度就自动报心理解释性 leading_question。",
      "知识开场没有个人两难，不应硬报 missing_dilemma_link；审校器也不应替被审候选生成一份新答案冒充原回答。"
    ]
  },
  {
    "id": "AUDIT_KNOWLEDGE_ANSWERED",
    "input": {
      "context": {
        "sessionId": "audit_probe_f",
        "revision": 1,
        "stage": "reflect",
        "allowNextStep": false,
        "modeId": "auto",
        "goal": null,
        "statements": [
          {
            "id": "u1",
            "kind": "expression",
            "text": "我想弄清写作里场景和概述最简单怎么区分，先讲基本意思，不用给我练习题。"
          }
        ],
        "dialogue": [],
        "claims": []
      },
      "candidate": {
        "modeId": "moment",
        "goal": "说明场景与概述的基本区别",
        "reply": "场景会把某个片刻展开来写，让读者跟着动作和对话经历；概述会把一段经过压缩交代。",
        "question": {
          "text": "这两个概念里，还有哪一点没分清？没有也可以先停在这里。",
          "target": "unknown",
          "evidenceIds": [
            "u1"
          ]
        },
        "claims": [],
        "finish": false,
        "title": "场景与概述的区别"
      },
      "task": "knowledge"
    },
    "expectedFindings": [],
    "reviewReasons": [
      "候选先给了与明确题面直接相关的简短定义，再邀请补充仍不清楚之处，没有把理解方向重新推回本人选择。",
      "后续问题允许没有或停止，不预设某种心理需要，也不强加练习任务，不能仅因回答后仍有问题就报 unanswered_explicit_request。",
      "这组只用于有限语义缺陷分类，不把人工候选当作写作理论专业准确性的完整评测，也不要求知识题制造个人两难。"
    ]
  }
]);
