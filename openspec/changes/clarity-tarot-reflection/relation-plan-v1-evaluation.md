# 两侧原话进入理解段的生成切片

状态：新私有生成契约、harness、16项新定向检查及固定8次真实生成 completed；4例窄范围pass、3 partial、1 unavailable，内容发布门槛not met。生产与UI/字体不变。沿用`clarity-tarot-reflection`，整体4/10，1.1/4.1 in progress、4.2 not started。

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

## Pre-run evidence (historical)

10项新定向通过，包含同一句两侧、raw/compiled同时保留、null不认证完整、来源重叠/歧义、退休材料不复活、故意裁否定/只拼引用的语义失败对照、时长/容量/保护/异步与取消。known4严格准备及可信容量检查通过（最终含问答来源与时长指引版本最大6127B），新4正文未读，真实新模型调用0。独立源码审阅和严格规范通过。审阅后保留每个active材料的实际questionLinks和既有durationSourcePolicy，防“是的/后者”等省略回答丢失问题语境；两者均不认证语义。binding明确区分新私有schema、旧material schema与公开clarity schema。harness/真实API离线集成、构建及真实8例生成待记录，尚未读取新4例。

策略先冻结`6fbcdc2a8112fb0a50b623ffd13b696f1d921c78`，root之后才读新4并原样序列化到最终fixture；原独立文件SHA256 `a4d684343812b7757efe7b1d8dd6a4d034946b38d273832591b7d497d43ca4ed`。新4全部严格准备通过，最大4441B，未按新内容调词。

core10+harness6共16项通过；相关faithful/source-checked 16项、原retention42项、严格规范和独立源码/harness审阅通过。真实handleApi+内存DB/stub provider的8例全部candidate/原话可见/保存读回，只证明工程；null stub未计语义成功。生产Worker dry-run 142.08KiB/gzip36.27KiB，实验Worker dry-run 320.82KiB/gzip76.82KiB通过，未跑旧版全量回归。执行关键依赖摘要扩为25份，含实际继承compiler/双guard及bounded capture。

真实前只读status200，默认仍百炼DeepSeek0813/revision3。待最终源码提交后运行固定8次，保留原生四字段raw、focus检查/完整原话、实际公开candidate及保存证据，再独立逐句评审；没有结果后补发或自动审校步骤。

## Actual generation and state evidence

运行源码`0f9fd97abdb41091ebaa38013e018b710c10c54f`，run `m20261101relation1a`，源树干净；25份执行关键源摘要和8份完整provider request/身份绑定核对一致，core从`6fbcdc2`到运行提交未变。8次实际模型请求/8份原生响应，7份合法四字段编为公开七字段candidate、actual apply、全部有效原话可见并内存保存/JSON读回。7份raw和compiled的两侧字面与继承时长检查独立重建通过；原话/私有trace/实际保存分别核对，不把它们计语义通过。

`RELATION_SINGLE_INFORMATION_NEED`的原生内容带Markdown JSON围栏，真实provider adapter在JSON解析时返回`provider_response_failed`，API fallback/candidate:null；没有进入compiler、apply或保存。保留原生围栏失败，不去围栏、补发或救活；runtimeRejectedOutputCount=0，不称编译器拦截。失败也产生实际usage，费用不能当0。

最大真实请求6127B/原12000B；默认模型及2000输出token边界不改。每例仅一次，没有追加审校、结果后调词或替换输入。7份可用输出全部选择非null focus，本批没有成功展示应留空时真实生成null。

## Independent content review

| 案例 | 结果 | 逐句结论 |
| --- | --- | --- |
| 花箱FULL收尾 | partial | 选了“不退出”与“怕尴尬”，没有选保护学习时间与怕拒绝后尴尬这份主要牵制；期待从“对方先问本人能否接”偏成“本人把拒绝说成商量”，不等于声称本人已拒绝。 |
| 休息/陪爸爸 | pass（有限） | 选对休息与怕被误解，形成有来源的有限区分；关系表达绕、引号密集，保留可读性caveat，不能称真人陪伴感已过。 |
| 具体反馈 | partial | 将具体意见与已否定的求夸硬配成focus；“不需要人人回应”被扩大为“不在意有没有任何回应”，不是原有两难。 |
| 柜号频次 | pass（有限） | 连起想核对与不全面指责，保留例外、具体影响及问题在哪的未知；部分reply抽象，内容只按本切片通过。 |
| 交流/猫照护 | partial | 两侧选对，但新增“担心会一直压着”的持续压力推断，未充分保留“可靠照护落实才愿去”的条件，不靠event原话完整抵消。 |
| 同事自主/项目风险 | pass（有限） | 自主与重要节点核对可并存的关系有来源；没有说同事已出错或已同意，措辞仍可更自然。 |
| 单一期待日期 | unavailable | 原生围栏解析失败，没有可应用candidate；围栏内文字可人工观察，不能剥去再计选择、保存或内容通过。 |
| 调岗未承诺/出差信息 | pass（有限） | optional关系保留未答应与是否出差的未知，不强判为心理两难，也不加强成愿意调岗；表达较机械。 |

总计4 pass/3 partial/1 unavailable。5个明确两侧样本4选真两侧、1错选；可用absent对照1个却强造关系，另1个absent不可用，optional1个关系合理；7个合法focus不等于7个真实两难。引用完整、保存成功与“有意义的拆解”仍须分开验收。新4例与known4都是合成受控收尾，不是统计盲测、完整交流或自然路由，也没有真人温馨感与易用性证据。

完整请求/raw、focus/原话定位、公开candidate、7份实际保存与独立逐句评审见[持久化证据](../../../ai/evaluations/2026-11-01-relation-plan-v1.json)，原live SHA256 `40c7fa5aa53920f2206cd9097d8fd71e53d95b9d68ba5ef5e9994125f38ec33b`。本轮同时改了私有结构与整段指令，不能单因果归咎字段结构，也不能据局部保留变好认定整体改善。

## Accounting and production boundary

精确8个request ID账本全部finished（7candidate/1fallback），输入8251/输出1631/总9882tokens与原生usage逐项相同。`organizer-unpriced-r3`未定价，金额未知。预览4199已停止，生产4项只读HTTP为主页200、未认证后台401、实验health404、AI状态200；默认服务仍百炼DeepSeek0813/revision3，100% Worker仍`d49f5c96-b8a0-4195-8404-b65561c73524`，部署`b45bb156-f01e-4345-9723-9cf5aec6cc2c`。未发布或修改配置/Key/预算/口令/DNS/D1结构/UI/字体/用户记录，仅合成调用记正常用量。未重复浏览器存储/刷新/PNG，无旧版全量回归。

## Next step

暂停扩展focus结构：本批原话与问答来源已在输入里，错误不是缺原话，字面回填无法替代选对关系；也不采用此前漏报审校放行。下一步建议回到旧三字段生成基线，对同一组冻结context、同一模型作单变量成对对照，只改是否加入少量自然成品示例，先验证选对目标/担心、条件、期待主体和无需强填；模型对照单列下一组，不同时换模型与契约。此下一步目前not started，不能提前称已有效。1.1/4.1 in progress、4.2 not started、整体4/10，无需用户重新配置Key。

后续进展：上述单变量示例配对现已执行，固定16次生成、逐句结果及下一步见[example-review-v1-evaluation.md](example-review-v1-evaluation.md)；本页not started描述保留为当时决策记录，不代表当前仍未执行。
