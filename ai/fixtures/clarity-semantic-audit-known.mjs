// 从既有真实合成输出提取的开发/已知对照，未改写原话或候选；不是新holdout。
// 仅input可送入审校，expected/origin/reviewReasons不入模型。
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const SEMANTIC_AUDIT_KNOWN_SAMPLES=freeze([
  {
    "id": "AUDIT_K_FULL_REVIEW",
    "input": {
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
      "candidate": {
        "modeId": "concern",
        "goal": "理清邻居临时多让我浇花是否意味着她默认我随时有空",
        "reply": "你愿意继续一起照顾花箱，介意的是临时多出来的两次没先问能不能接、还占用了原本留给日语的时间。",
        "question": null,
        "claims": [
          {
            "type": "event",
            "text": "我和邻居轮流照看楼下的花箱，这周她临时又让我多浇了两次。\n我开始怀疑她是不是默认我随时都有空。\n我们原本只约好我周二、周五浇。\n她周一和周四临时发来“今天你浇一下”，我都照做了；那两次各花了半小时，原本留给学日语的时间被占了，后来也没补上。\n我愿意一起照顾花箱，介意的是临时多出来的事没有先问我能不能接。\n我想把学日语的时间留住，又怕拒绝以后见面尴尬。\n希望临时换班时先问我能不能接；我没空就一起找其他办法。\n我不是要退出照看花箱，也还没和她谈过这个安排。",
            "evidenceIds": [
              "u1",
              "u2",
              "u3",
              "u4"
            ],
            "derivation": "stated",
            "supersedes": []
          },
          {
            "type": "insight",
            "text": "我愿意一起照看花箱，也愿意继续这个安排；但这不等于我随时都能接临时增加的事，尤其那两次各占了我半小时、学日语的时间后来也没补上。",
            "evidenceIds": [
              "u2",
              "u3",
              "u4"
            ],
            "derivation": "inferred",
            "supersedes": []
          }
        ],
        "finish": true,
        "title": "临时浇花与“随时有空”的区分"
      },
      "task": "review"
    },
    "expectedFindings": [
      "missing_dilemma_link"
    ],
    "reviewReasons": [
      "只核本次Host task下三类窄范围问题；不按v6整案pass/partial直接替代审校标签。"
    ],
    "origin": {
      "file": "ai/evaluations/2026-11-01-faithful-dialogue-v6.json",
      "sha256": "9554715b07e8fa0e12970d190a9ffeb98269d6c1a4d8a394a0d635934c763fc7",
      "caseId": "V2_FULL_DIALOGUE",
      "step": 4
    }
  },
  {
    "id": "AUDIT_K_CHOICE",
    "input": {
      "context": {
        "sessionId": "retention6_m20261101v6a_probe_4",
        "revision": 1,
        "stage": "reflect",
        "allowNextStep": false,
        "modeId": "auto",
        "goal": null,
        "statements": [
          {
            "id": "u1",
            "text": "我想报一门陶艺课。周三晚的班离家近，但会挤掉跑步时间；周日下午的班远一些，却能和朋友一起去。我还没决定，更在意能不能长期坚持。",
            "kind": "expression"
          }
        ],
        "dialogue": [],
        "claims": []
      },
      "candidate": {
        "modeId": "choice",
        "goal": "帮用户比较两个陶艺班选项，围绕长期坚持的标准找出还缺的实际信息。",
        "reply": "你已经在两个具体班次之间比较，并且把长期坚持放在前面，这个标准很清楚。",
        "question": {
          "text": "你过去坚持跑步或类似安排时，是更容易被距离和时间打断，还是更需要有人一起才更可能持续？",
          "target": "need",
          "evidenceIds": [
            "u1"
          ]
        },
        "claims": [
          {
            "type": "need",
            "text": "选择陶艺班时更在意能不能长期坚持。",
            "evidenceIds": [
              "u1"
            ],
            "derivation": "stated",
            "supersedes": []
          }
        ],
        "finish": false,
        "title": "比较周三晚与周日下午陶艺班"
      },
      "task": "reflect"
    },
    "expectedFindings": [
      "leading_question"
    ],
    "reviewReasons": [
      "只核本次Host task下三类窄范围问题；不按v6整案pass/partial直接替代审校标签。"
    ],
    "origin": {
      "file": "ai/evaluations/2026-11-01-faithful-dialogue-v6.json",
      "sha256": "9554715b07e8fa0e12970d190a9ffeb98269d6c1a4d8a394a0d635934c763fc7",
      "caseId": "ROUTE_CHOICE_TRADEOFF",
      "step": 1
    }
  },
  {
    "id": "AUDIT_K_INTEREST_UNANSWERED",
    "input": {
      "context": {
        "sessionId": "retention6_m20261101v6a_probe_11",
        "revision": 1,
        "stage": "reflect",
        "allowNextStep": false,
        "modeId": "auto",
        "goal": null,
        "statements": [
          {
            "id": "u1",
            "text": "我最近迷上了老电影的布景，想知道镜头里那些房间怎么用颜色营造气氛，先不用推荐片单。",
            "kind": "expression"
          }
        ],
        "dialogue": [],
        "claims": []
      },
      "candidate": {
        "modeId": "moment",
        "goal": "承接对老电影布景用色的好奇",
        "reply": "你想看的不是片单，而是镜头里那些房间怎么用颜色说话。",
        "question": {
          "text": "你更想从色彩搭配、光线关系，还是某个年代的布景风格聊起？",
          "target": "unknown",
          "evidenceIds": [
            "u1"
          ]
        },
        "claims": [],
        "finish": false,
        "title": "老电影房间布景的颜色氛围"
      },
      "task": "knowledge"
    },
    "expectedFindings": [
      "unanswered_explicit_request"
    ],
    "reviewReasons": [
      "只核本次Host task下三类窄范围问题；不按v6整案pass/partial直接替代审校标签。"
    ],
    "origin": {
      "file": "ai/evaluations/2026-11-01-faithful-dialogue-v6.json",
      "sha256": "9554715b07e8fa0e12970d190a9ffeb98269d6c1a4d8a394a0d635934c763fc7",
      "caseId": "V6_INTEREST_ALREADY_SPECIFIED",
      "step": 1
    }
  },
  {
    "id": "AUDIT_K_CHOICE_OPEN",
    "input": {
      "context": {
        "sessionId": "retention6_m20261101v6a_probe_10",
        "revision": 1,
        "stage": "reflect",
        "allowNextStep": false,
        "modeId": "auto",
        "goal": null,
        "statements": [
          {
            "id": "u1",
            "text": "我在考虑在家练琴，或者周末去朋友常去的排练室。在家随时能练，排练室能和朋友碰面但要预约。我想练得稳定些，还不确定朋友在场对我有帮助还是分心。",
            "kind": "expression"
          }
        ],
        "dialogue": [],
        "claims": []
      },
      "candidate": {
        "modeId": "choice",
        "goal": "整理在家练琴与去排练室之间的取舍",
        "reply": "你在意的是练琴能不能稳定，而两种方式各有各的牵动：在家不受限制，去排练室能见到朋友，但你还不确定朋友在场是助力还是分心。",
        "question": {
          "text": "你去排练室练琴的话，通常能约到什么时段、一次能练多久？",
          "target": "unknown",
          "evidenceIds": [
            "u1"
          ]
        },
        "claims": [],
        "finish": false,
        "title": "在家练琴还是去排练室"
      },
      "task": "reflect"
    },
    "expectedFindings": [],
    "reviewReasons": [
      "只核本次Host task下三类窄范围问题；不按v6整案pass/partial直接替代审校标签。"
    ],
    "origin": {
      "file": "ai/evaluations/2026-11-01-faithful-dialogue-v6.json",
      "sha256": "9554715b07e8fa0e12970d190a9ffeb98269d6c1a4d8a394a0d635934c763fc7",
      "caseId": "V6_CHOICE_COMPANY_UNKNOWN",
      "step": 1
    }
  },
  {
    "id": "AUDIT_K_INTEREST_FOLLOWUP",
    "input": {
      "context": {
        "sessionId": "retention6_m20261101v6a_probe_2",
        "revision": 1,
        "stage": "reflect",
        "allowNextStep": false,
        "modeId": "auto",
        "goal": null,
        "statements": [
          {
            "id": "u1",
            "text": "你了解观鸟吗？我最近有点好奇，想知道大家一般会看些什么。",
            "kind": "expression"
          }
        ],
        "dialogue": [],
        "claims": []
      },
      "candidate": {
        "modeId": "moment",
        "goal": "承接对观鸟的好奇",
        "reply": "观鸟大概知道一些：大家通常会看鸟的种类、外形、叫声、行为，也会留意它们出现的季节和栖息环境。",
        "question": {
          "text": "你比较想了解哪方面，是常见的鸟种，还是怎么开始观察？",
          "target": "unknown",
          "evidenceIds": [
            "u1"
          ]
        },
        "claims": [],
        "finish": false,
        "title": "观鸟好奇"
      },
      "task": "knowledge"
    },
    "expectedFindings": [],
    "reviewReasons": [
      "只核本次Host task下三类窄范围问题；不按v6整案pass/partial直接替代审校标签。"
    ],
    "origin": {
      "file": "ai/evaluations/2026-11-01-faithful-dialogue-v6.json",
      "sha256": "9554715b07e8fa0e12970d190a9ffeb98269d6c1a4d8a394a0d635934c763fc7",
      "caseId": "ROUTE_INTEREST_OPENER",
      "step": 1
    }
  },
  {
    "id": "AUDIT_K_HAPPY_RECORD",
    "input": {
      "context": {
        "sessionId": "retention6_m20261101v6a_probe_3",
        "revision": 1,
        "stage": "reflect",
        "allowNextStep": false,
        "modeId": "auto",
        "goal": null,
        "statements": [
          {
            "id": "u1",
            "text": "今天和朋友骑车到河边，风很舒服，回来还一起吃了热汤面。我一路都很开心，想把这个晚上记下来。",
            "kind": "expression"
          }
        ],
        "dialogue": [],
        "claims": []
      },
      "candidate": {
        "modeId": "moment",
        "goal": "记下这个开心的晚上",
        "reply": "好，这个晚上值得原样留住：骑车去河边，风很舒服，回来还一起吃了热汤面，一路都开心。",
        "question": null,
        "claims": [
          {
            "type": "event",
            "text": "今天和朋友骑车到河边，风很舒服，回来还一起吃了热汤面。我一路都很开心，想把这个晚上记下来。",
            "evidenceIds": [
              "u1"
            ],
            "derivation": "stated",
            "supersedes": []
          }
        ],
        "finish": true,
        "title": "和朋友骑车去河边的晚上"
      },
      "task": "review"
    },
    "expectedFindings": [],
    "reviewReasons": [
      "只核本次Host task下三类窄范围问题；不按v6整案pass/partial直接替代审校标签。"
    ],
    "origin": {
      "file": "ai/evaluations/2026-11-01-faithful-dialogue-v6.json",
      "sha256": "9554715b07e8fa0e12970d190a9ffeb98269d6c1a4d8a394a0d635934c763fc7",
      "caseId": "ROUTE_HAPPY_MOMENT",
      "step": 1
    }
  },
  {
    "id": "AUDIT_K_SHARED_SCOPE",
    "input": {
      "context": {
        "sessionId": "retention6_m20261101v6a_probe_9",
        "revision": 1,
        "stage": "reflect",
        "allowNextStep": false,
        "modeId": "auto",
        "goal": null,
        "statements": [
          {
            "id": "u1",
            "text": "我愿意和表姐一起准备家宴。她临时让我把甜点也全做了，我没顾上休息。我介意没先商量，也介意多出来的活，并不是问过我就一定会接。",
            "kind": "expression"
          }
        ],
        "dialogue": [],
        "claims": []
      },
      "candidate": {
        "modeId": "concern",
        "goal": "理清这次一起准备家宴时，临时加活和没先商量带来的困扰",
        "reply": "你愿意一起准备，但表姐临时把甜点全交给你，你连休息都没顾上，这让你介意。",
        "question": {
          "text": "能说说最近一次发生时，具体是什么情形吗？",
          "target": "event",
          "evidenceIds": [
            "u1"
          ]
        },
        "claims": [],
        "finish": false,
        "title": "一起准备家宴时临时加活"
      },
      "task": "reflect"
    },
    "expectedFindings": [],
    "reviewReasons": [
      "只核本次Host task下三类窄范围问题；不按v6整案pass/partial直接替代审校标签。"
    ],
    "origin": {
      "file": "ai/evaluations/2026-11-01-faithful-dialogue-v6.json",
      "sha256": "9554715b07e8fa0e12970d190a9ffeb98269d6c1a4d8a394a0d635934c763fc7",
      "caseId": "V6_SHARED_WORK_EXTRA_SCOPE",
      "step": 1
    }
  },
  {
    "id": "AUDIT_K_CONCERN_FOLLOWUP",
    "input": {
      "context": {
        "sessionId": "retention6_m20261101v6a_V2_FULL_DIALOGUE",
        "revision": 2,
        "stage": "reflect",
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
          }
        ],
        "dialogue": [
          {
            "question": "能说说最近一次发生时，具体是什么情形吗？",
            "answerId": "u2"
          }
        ],
        "claims": []
      },
      "candidate": {
        "modeId": "concern",
        "goal": "理清邻居临时多让我浇花是否意味着她默认我随时有空",
        "reply": "你原本只约好周二、周五浇，结果周一、周四临时被叫去各花了半小时，学日语的时间也没补上。",
        "question": {
          "text": "这件事里，最让你介意的是什么？",
          "target": "interpretation",
          "evidenceIds": [
            "u2"
          ]
        },
        "claims": [],
        "finish": false,
        "title": "邻居临时多让我浇花"
      },
      "task": "reflect"
    },
    "expectedFindings": [],
    "reviewReasons": [
      "只核本次Host task下三类窄范围问题；不按v6整案pass/partial直接替代审校标签。"
    ],
    "origin": {
      "file": "ai/evaluations/2026-11-01-faithful-dialogue-v6.json",
      "sha256": "9554715b07e8fa0e12970d190a9ffeb98269d6c1a4d8a394a0d635934c763fc7",
      "caseId": "V2_FULL_DIALOGUE",
      "step": 2
    }
  }
]);
