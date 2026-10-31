# 两侧原话进入理解段的生成切片

状态：新私有生成契约和10项定向检查 completed，独立审阅通过，隔离harness in progress，真实生成 not started；生产与UI/字体不变。沿用`clarity-tarot-reflection`，整体4/10，1.1/4.1 in progress、4.2 not started。

## Responsibility and scope

上一批审校的两难遗漏0/2检出，不能用作自动放行。本轮改生成责任，不加另一轮付费审校：同一份模型响应显式选择两侧原话，再写理解。不能把输出字段的先后顺序称为已观察到的模型计算过程；focus只是同call候选计划，不是用户已确认的关系或心理事实。

私有`liubai-relation-plan-1`/策略`clarity-relation-plan-1`恰好reply/title/focus/claims。focus显式null或left/right，各含active anchorId及精确quote；同一句可含两侧，不强制不同anchor。旧候选goal只作提示，materials优先。没有明确并存牵制时可以null，不按fixture强制选择；明确两难样例上null仍可机械通过，但内容评审应记选择漏失。

只从当前ledger active unit.text选，正向纠正后不能重新取旧anchor.quote。trace保留完整active句、projection、全部UTF16相对/绝对匹配位置；源多匹配明确ambiguous，不任选first认证归属。同source区间重叠不能算两侧。focus存在必须有一个insight，raw及最终compiled同一理解段包含两个非重叠原话片段，引用覆盖两侧；非法focus不降成null，也不丢句补证据或重试。

原retention event仍由Host完整组装，公开七字段、每条240/总480、profile/快照、保护/取消、既有时长原形检查不变；focus不进入公开candidate、保存或UI，不增加确认步骤。过长明确拒绝，不裁关键限定、抬限或第二次调用。只测试短concern/review，停止/只留原话等原有不支持范围继续明确不支持，不代表线上功能被移除。

引用完整不等于关系正确：裁掉否定/条件的短引文、选错两句、仅拼接但没有认识仍可能机械通过。本版故意保留这些合法负对照，标literal_relation_plan_only、semanticTruth=unverified，不靠关键词、引用数或此前漏报的审校认证内容。

## Freeze and evaluation plan

先冻结策略/测试和已知4例，再读独立agent新4例正文；实现者冻结前不读新正文，不称统计盲测。known为旧完整花箱收尾、旧休息/爸爸两难、具体反馈与柜号频次收尾；仅context入模型，origin/expectedRelation/要求不入模型。新4例包含实际并存顾虑/条件和不应强填的对照，没有期望候选文字。

固定8例各生成一次，不补固定未来回答、不改context或引用去迎合结果、不重试或结果后调词。只验证受控review，不冒称完整四轮或自由路由；每例严格核对真实prepared request、原生四字段JSON、focus前后检查、公开candidate、actual apply、全部有效原话可见和内存保存/JSON读回。保留拒绝与失败，引用/保存/语义分别计数。

沿用现有默认百炼DeepSeek0813/revision3和真实计费/幂等，原可信12000B/2000输出token不变，金额未知如实记录。固定8是实验长度，不是用户聊天/费用上限。实验复用已修响应捕获界限；不变更生产API/flow/D1结构/组织者配置/Key/预算/口令/域名/字体。内容门槛未过不发布，无需用户重新配Key。

## Pre-run evidence

10项新定向通过，包含同一句两侧、raw/compiled同时保留、null不认证完整、来源重叠/歧义、退休材料不复活、故意裁否定/只拼引用的语义失败对照、时长/容量/保护/异步与取消。known4严格准备及可信容量检查通过（最终含问答来源与时长指引版本最大6127B），新4正文未读，真实新模型调用0。独立源码审阅和严格规范通过。审阅后保留每个active材料的实际questionLinks和既有durationSourcePolicy，防“是的/后者”等省略回答丢失问题语境；两者均不认证语义。binding明确区分新私有schema、旧material schema与公开clarity schema。harness/真实API离线集成、构建及真实8例生成待记录，尚未读取新4例。
