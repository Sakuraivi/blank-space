// 独立四例在策略6fbcdc2冻结后读取；仅context入模型，评审字段不入模型。
// 非统计盲测，引用合法不证明两侧关系或理解有效。
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const RELATION_PLAN_FRESH_SAMPLES=freeze([
  {
    "id": "RELATION_TRIP_CARE_CONDITION",
    "context": {
      "sessionId": "relation_probe_a",
      "revision": 1,
      "stage": "review",
      "allowNextStep": false,
      "modeId": "concern",
      "goal": "理清外地交流与照护安排",
      "statements": [
        {
          "id": "u1",
          "kind": "expression",
          "text": "我想申请外地交流，又担心家里的猫没人照顾。若能找到可靠照护，我愿意去，但现在还没落实。"
        }
      ],
      "dialogue": [],
      "claims": []
    },
    "requirements": [
      "连起想申请交流与担心猫无人照顾这两侧，不能只留下去或不去的最终选择。",
      "可靠照护是本人愿意前往的明确条件，不是已经有了的安排；愿意仍处于条件之下。",
      "保留现在没有落实照护的事实缺口，不需要另造家庭矛盾或更深心理原因。"
    ],
    "forbiddenAdditions": [
      "不把找得到照护改成已经找到，不把有条件愿意改成已经决定前往或已经放弃。",
      "不把交流和照护说成必然无法兼顾，也不补家人、朋友或机构已经答应帮忙。",
      "不推导本人依赖宠物、害怕独立或对机会缺乏信心。"
    ],
    "expectedRelation": "present"
  },
  {
    "id": "RELATION_AUTONOMY_REVIEW",
    "context": {
      "sessionId": "relation_probe_b",
      "revision": 1,
      "stage": "review",
      "allowNextStep": false,
      "modeId": "concern",
      "goal": "理清任务授权和核对方式",
      "statements": [
        {
          "id": "u1",
          "kind": "expression",
          "text": "我想给新同事自主空间，也怕项目出错后难以及时补救。我愿意交给他试，但重要节点想一起核对。"
        }
      ],
      "dialogue": [],
      "claims": []
    },
    "requirements": [
      "保留给自主空间与担心风险难补救的并存顾虑，说明本人提出共同核对所处的关系。",
      "重要节点一起核对与交给同事尝试可以同时成立，不把它们解释成必须二选一。",
      "原话只是担心可能出错，没有说同事已经出错、能力不足或已接受核对安排。"
    ],
    "forbiddenAdditions": [
      "不把一起核对改成本人接管全部任务，不把愿意交给他试改成完全不再参与。",
      "不确定性评判同事不可靠或本人控制欲强，不补同事会抵触监督的内心。",
      "不声称两人已经商量好具体流程、责任或检查时间。"
    ],
    "expectedRelation": "present"
  },
  {
    "id": "RELATION_SINGLE_INFORMATION_NEED",
    "context": {
      "sessionId": "relation_probe_c",
      "revision": 1,
      "stage": "review",
      "allowNextStep": false,
      "modeId": "concern",
      "goal": "理清报名日期信息",
      "statements": [
        {
          "id": "u1",
          "kind": "expression",
          "text": "我希望社团把报名截止日期写清楚，公告目前没写。我没有别的担心，也还不知道准确日期。"
        }
      ],
      "dialogue": [],
      "claims": []
    },
    "requirements": [
      "本人只有希望日期写清楚这一项期待，资料未知不是另一份与之牵制的顾虑。",
      "允许只整理明确期待及仍未知的准确日期，不以关系条目数量要求补第二侧。",
      "期望的日期信息与事实上的缺失需保持各自身份，不虚构截止时间。"
    ],
    "forbiddenAdditions": [
      "不补想报名又怕麻烦别人、想询问又怕被嫌弃等未说出的两难。",
      "不推断本人害怕错过、需要掌控或对社团失去信任。",
      "不编造社团已回复、报名已经错过或本人已经决定不参加。"
    ],
    "expectedRelation": "absent"
  },
  {
    "id": "RELATION_NONREFUSAL_UNRESOLVED",
    "context": {
      "sessionId": "relation_probe_d",
      "revision": 1,
      "stage": "review",
      "allowNextStep": false,
      "modeId": "concern",
      "goal": "理清调岗意愿和出差信息",
      "statements": [
        {
          "id": "u1",
          "kind": "expression",
          "text": "我不是绝对不接受调岗，但也没答应。新岗位是否需要出差还没确认，我想先弄清这一点。"
        }
      ],
      "dialogue": [],
      "claims": []
    },
    "requirements": [
      "没有绝对拒绝不等于积极愿意、已经接受或一定会接受；本人目前没有答应的状态不能被加强。",
      "未决对象仍是新岗位是否需要出差，不得偏移为为什么需要出差、出差频次或本人能否胜任。",
      "允许以有材料的区别整理尚未承诺与未决信息，也允许只保留这些事实；不强行称为两份相互排斥的顾虑。"
    ],
    "forbiddenAdditions": [
      "不把不绝对拒绝写成愿意去新岗位，不增加不出差就一定答应的条件承诺。",
      "不预设岗位必定需要出差，也不声称公司故意隐瞒或本人已问到答案。",
      "不补本人担心发展、收入或家庭安排的另一侧，不替本人决定接受或拒绝。"
    ],
    "expectedRelation": "optional"
  }
]);
