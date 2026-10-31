// 已知受控review开发/回归材料，来自旧真实合成context或旧审校材料，不是新holdout。
// 只context进模型，origin/expectedRelation/评审要求不进模型。
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const RELATION_PLAN_KNOWN_SAMPLES=freeze([
  {
    "id": "RELATION_K_FULL",
    "context": {
      "sessionId": "retention6_m20261101v6a_V2_FULL_DIALOGUE",
      "revision": 4,
      "stage": "review",
      "allowNextStep": false,
      "modeId": "concern",
      "goal": "理清邻居临时多让我浇花是否意味着她默认我随时有空",
      "statements": [
        {
          "id": "u1",
          "text": "我和邻居轮流照看楼下的花箱，这周她临时又让我多浇了两次。我开始怀疑她是不是默认我随时都有空。",
          "kind": "expression"
        },
        {
          "id": "u2",
          "text": "我们原本只约好我周二、周五浇。她周一和周四临时发来“今天你浇一下”，我都照做了；那两次各花了半小时，原本留给学日语的时间被占了，后来也没补上。",
          "kind": "expression"
        },
        {
          "id": "u3",
          "text": "我愿意一起照顾花箱，介意的是临时多出来的事没有先问我能不能接。我想把学日语的时间留住，又怕拒绝以后见面尴尬。",
          "kind": "expression"
        },
        {
          "id": "u4",
          "text": "希望临时换班时先问我能不能接；我没空就一起找其他办法。我不是要退出照看花箱，也还没和她谈过这个安排。",
          "kind": "expression"
        }
      ],
      "dialogue": [
        {
          "question": "能说说最近一次发生时，具体是什么情形吗？",
          "answerId": "u2"
        },
        {
          "question": "这件事里，最让你介意的是什么？",
          "answerId": "u3"
        },
        {
          "question": "你希望接下来有什么具体的不同？",
          "answerId": "u4"
        }
      ],
      "claims": []
    },
    "origin": {
      "file": "ai/evaluations/2026-11-01-faithful-dialogue-v6.json",
      "sha256": "9554715b07e8fa0e12970d190a9ffeb98269d6c1a4d8a394a0d635934c763fc7",
      "caseId": "V2_FULL_DIALOGUE",
      "step": 4
    },
    "expectedRelation": "present",
    "requirements": [
      "连起希望留学日语时间与怕拒绝后尴尬，保留临时换班先问的具体期待及第三方意图未知。"
    ],
    "forbiddenAdditions": [
      "不把愿意一起照看扩成不介意额外负担；不把担心当既定后果。"
    ]
  },
  {
    "id": "RELATION_K_REST_FAMILY",
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
    "origin": {
      "file": "ai/fixtures/clarity-semantic-audit-fresh.mjs",
      "sha256": "35b18c539057086fe0ee32a143f4ba8ac6750e3afca6b196865fee88eaf75a5a",
      "caseId": "AUDIT_DILEMMA_OMISSION"
    },
    "expectedRelation": "present",
    "requirements": [
      "连起想休息/表达需要与怕爸爸误解不愿陪伴，不能只留下休息。"
    ],
    "forbiddenAdditions": [
      "不确定爸爸内心、不替本人决定拒绝或必须赴约。"
    ]
  },
  {
    "id": "RELATION_K_FEEDBACK",
    "context": {
      "sessionId": "retention4_m20261101v4a_V2_GROUP_FEEDBACK",
      "revision": 3,
      "stage": "review",
      "allowNextStep": false,
      "modeId": "concern",
      "goal": "梳理这次表达",
      "statements": [
        {
          "id": "u1",
          "text": "我在邻里换书群发了两版书架标签，只有小禾回了一个点头的表情，其他人没说话。我开始怀疑标签是不是写得太复杂。",
          "kind": "expression"
        },
        {
          "id": "u2",
          "text": "这两版标签是我花两个晚上整理十几本书后做的。那个表情没有说明哪一版更容易看懂。",
          "kind": "expression"
        },
        {
          "id": "u3",
          "text": "我想得到一个关于哪版更清楚的具体意见，不需要每个人都回复，也不是想让大家夸我做得多。",
          "kind": "expression"
        }
      ],
      "dialogue": [],
      "claims": []
    },
    "origin": {
      "file": "ai/evaluations/2026-11-01-guided-retention-v4.json",
      "sha256": "d39ceec438d448c018077b014a0fd12d9f1323dd3b1e4b34188672f791ab1e0f",
      "caseId": "V2_GROUP_FEEDBACK",
      "step": 1
    },
    "expectedRelation": "absent",
    "requirements": [
      "保留想要具体哪版清楚的反馈、并非要求每人回复/夸奖；原标签是否复杂未知。"
    ],
    "forbiddenAdditions": [
      "不制造被看见或认可的心理需要，不把明确排除的夸奖当第二份愿望。"
    ]
  },
  {
    "id": "RELATION_K_REMINDER",
    "context": {
      "sessionId": "retention4_m20261101v4a_V2_FREQUENCY_EXCEPTION",
      "revision": 3,
      "stage": "review",
      "allowNextStep": false,
      "modeId": "concern",
      "goal": "梳理这次表达",
      "statements": [
        {
          "id": "u1",
          "text": "我在楼下小店取过四次东西，其中两次收到的柜号不对。昨天那次柜号是对的，不是每次都出错。",
          "kind": "expression"
        },
        {
          "id": "u2",
          "text": "那两次我各多走了十分钟，才在另一个柜子找到东西。我当时有点烦。",
          "kind": "expression"
        },
        {
          "id": "u3",
          "text": "我想请店员发提醒前核对柜号，又不想把这两次说成他们总出错。我还不知道问题出在提醒里还是柜子的标号上。",
          "kind": "expression"
        }
      ],
      "dialogue": [],
      "claims": []
    },
    "origin": {
      "file": "ai/evaluations/2026-11-01-guided-retention-v4.json",
      "sha256": "d39ceec438d448c018077b014a0fd12d9f1323dd3b1e4b34188672f791ab1e0f",
      "caseId": "V2_FREQUENCY_EXCEPTION",
      "step": 1
    },
    "expectedRelation": "present",
    "requirements": [
      "连起希望提醒前核对与不想把两次泛化为总出错，保留四次两错/昨天正确、两次各十分钟、有点烦及问题在哪的未知。"
    ],
    "forbiddenAdditions": [
      "不造全都出错、确定对方马虎/故意或额外时间合计。"
    ]
  }
]);
