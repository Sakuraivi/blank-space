# 小范围语义审校实验

状态：私有协议、隔离harness、20项新定向检查及14次真实审校 completed；审校语义门槛 not met，不能自动放行。沿用`clarity-tarot-reflection`的质量评估任务；1.1/4.1 in progress、4.2 not started，整体4/10。生产、界面、字体与组织者配置不变。

## Responsibility and scope

本轮先验证审校能否定位上一批剩余问题，不修改用户候选，不增加线上生成调用。私有`liubai-semantic-audit-1`/策略`clarity-semantic-audit-1`输入固定context、实际七字段候选与Host task，输出findings观察。Runtime成功转换为`completed/audit`，删除公共candidate字段，复用已有默认来源、可信route、幂等和计费；不调用apply、保存、确认或续步，不修改生产API/flow/ledger。

Host固定范围：review只查missing_dilemma_link，需候选已收尾；reflect只查leading_question；knowledge首轮查leading_question与unanswered_explicit_request。知识后续轮因缺完整旧assistant答复不支持，不猜测“此前一直未回答”。遗漏两难须看全部相关分析，不能因局部句子少了一个词就报，也不强迫普通reflect每轮造洞察。只记片刻、明确不分析、无真实拉扯时不制造问题；同一来源可含两项顾虑。

提问按语义检查预设，不按二选一/有没有等句式判。本人主动验证因素、可否定的事实确认、必要细化可能合理。知识题的简短/部分实质回答、诚实不确定、确实必要澄清不能一律误报；不评外部知识准确性。

模型只输出0–3个finding，每项kind/fieldId/candidateQuote/sources/reason。Host提供reply/question/claim文字manifest并解析精确JSON Pointer；goal/title作为背景完整提供，不在定位范围，数值、强度、诊断等不在本版类型覆盖内。引用逐字匹配全部UTF16位置，未知field/来源、改述quote、非法kind-target、额外字段和重复finding拒绝，不删句、补引或修围栏。event逐字复制不等于分析；unknown须整体阅读、若已连起不报，但不作为finding定位目标。整体缺口可定位真实reply。reason是问题说明，不提供替换文案、行动或心理诊断。

精确引用只证明定位可回放，不证明遗漏成立；合法但错误的指控仍可通过格式并保持semanticTruth=unverified、authority=observation_only。空findings仅未检出，格式失败/超时是不可用，都不能记内容pass；schema、sources与模型自评不能裁定用户状态。来源中的执行指令作为数据，原用户只留原话的意愿可影响内容要求，但不能切换审校职责。

## Freeze and evaluation plan

先冻结core策略/测试与已知对照，再读取独立agent新6例正文。新作者不看策略，root冻结前不读正文；最终harness另行冻结，不称统计盲测或全产品准确率。固定14例，每例一次：8份v6实际已知候选（3个目标缺陷、5个合理对照），6份新人工正反例（三类各1缺陷/1合理）。仅input进入模型，不给case/session标签、来源artifact路径/版本、expectedFindings或评审答案；候选和原话不改写。

运行必须保留完整原生JSON、引用前后结果、实际完整请求与源码/快照/模型绑定，无自动重试、改写或结果后调词。独立auditor Worker，不接管v6用户候选应用分支，健康/run窗口、默认百炼DeepSeek0813/revision3、原12000B可信请求和45秒Runtime边界保持。每次审校是新模型调用，记录精确账本tokens；未核实单价金额未知。固定14只是实验长度，不是用户费用上限。

结果区分协议可用与语义有效：逐finding人工核对理由/来源/类型，统计检出、漏报、误报与不可用；不能只按kind命中或空数组计成功。合理开放问题、事实确认、片刻与必要澄清纳入防误报。原known标签是本次三类检查下的预期，不直接沿用v6整案pass/partial。审校有效之前不进入生产，也不自动修正文案。

## Pre-run evidence (historical)

core10项检查通过，包括原候选不变、task范围、全部UTF16匹配、私有completed无用户candidate、未知/改述引用拒绝、合法假控告不被认证、恶意来源隔离、pre-await快照、取消/晚响应无重试。已知8份真实候选严格校验与可信transport通过，最终最大7491B/12000B；当时新6例正文未读。独立源码审阅及严格规范校验通过；已修复非字符串task经JS键强制转换绕过scope的漏洞并补反例，此时真实审校调用0。

策略冻结于`e3ef58e34f7c84ab9023f245d389398aae2ff3ce`后root才读新6例并映射最终fixture，原独立文件SHA256 `fe36fd068cc29525caf9548d887267ec1e93342671d4c542b798f9723cab5633`。正文/候选/期望未改，未根据新例调词。14个严格input准备通过，known最大7491B、fresh最大4895B。

core10+harness10共20项通过，包括真实handleApi+内存SQLite/合成加密配置/stub provider的14行finished/completed、0candidate/started，不调用应用状态。另17项相邻对话检查、生产Worker构建dry-run、严格规范通过；没有旧版全量回归。独立harness审阅发现响应捕获中止/无独立截止的问题，补初始及订阅后abort检查、最多10秒独立读取截止、空chunk界限与失败时取消原body，防止后续adapter继续读挂住的body；3项新增边界测试及实际API账本fallback通过，仍无真实模型调用。

默认服务只读status200仍为百炼DeepSeek0813/revision3。审校completed在原通用diagnostics中归other，实验必须按独立label/requestId和精确账本分开记录，不混作用户candidate成功率。最终独立源码复核通过；实验Worker dry-run复查187.75KiB/gzip45.25KiB通过。现在待最终源码冻结，再做真实14例及语义误报/漏报评审，运行前记录保留。

## Actual run and adjudication

最终源码`f896532c1a4ce6de7c665f89a8adc901fa0d6afd`、run `m20261101audit1a`，源树干净；14份执行源摘要、prepared完整请求、Host绑定、原生JSON与私有compiled audit/API envelope逐项独立核对通过。core从`e3ef58e`到运行提交字节未变，无结果后调词、改输入、修围栏或重试。14次客户端attempt=14次实际模型调用=14份completed私有观察；0公共candidate、0state应用、0用户记录写入，不能把completed记内容合格。

独立逐finding核对后，6份缺陷检出3份、漏报3份；8份合理对照本批无误报，8份范围内正确未报；不可用0。实际3条finding均有来源与候选的整体支持，reason无替换文案或外部知识断言；3个定位是3个不同问题，无重复定位。11份空findings里包含3份漏报，直接证明空结果不能自动放行。

| 检查类型 | 缺陷例 | 检出 | 漏报 | 观察 |
| --- | --- | --- | --- | --- |
| 收尾两难未连起 | 2 | 0 | 2 | 已知花箱与新休息/陪爸爸都漏报；event保留原话仍掩盖了分析只接一侧。 |
| 提问预设方向 | 2 | 1 | 1 | 检出“只有同行才坚持”，漏掉较隐蔽的距离时间/需要陪同二驱动力框架。 |
| 未回应明确题面 | 2 | 2 | 0 | 两份只复述题面的兴趣回应均检出；两份先作实质回答再细化未误报，仍是小样本。 |

known组1检出/2漏报/5正确未报；fresh组2检出/1漏报/3正确未报。类型覆盖可重叠（knowledge同时允许检查提问和答题），不能把分类型分母相加为独立总体样本；也不把这批3/6或0误报外推为总体性能。评审者也编写新六例，不称统计独立盲测。

完整14份输入、原生raw、私有观察、逐finding理由及漏报证据见[持久化评估](../../../ai/evaluations/2026-11-01-semantic-audit-v1.json)，原报告SHA256 `fc9c0fa3ba78d5fc9b81b39f6bd1975255f26d476101d6c4b5806cdc1a9e9b5c`。审校协议可用，不代表语义检出能力已够用；三条成立的意见可供人复核，不能自动改正文、确认状态或接管原产品内容验收。

## Accounting and deployment boundary

实际最大body7491B/12000B，原可信route不变。精确14个request ID账本全部finished/completed，0started；输入14867、输出390、总15257tokens与原生usage逐项一致。价格版本`organizer-unpriced-r3`未定价，金额未知，不是免费。未进行任何生成替换调用，原v6输出和内容结论保持。

预览4199已关闭；生产4项只读HTTP分别主页200、未认证后台401、实验health404、AI状态200，默认配置仍百炼DeepSeek0813/revision3。当前100%仍是Worker `d49f5c96-b8a0-4195-8404-b65561c73524`，部署`b45bb156-f01e-4345-9723-9cf5aec6cc2c`；没有发布、组织者配置/Key/预算/口令/DNS/D1结构/UI/字体/用户记录修改，仅合成审校产生正常用量账本。本轮无浏览器存储、刷新、PNG或真人温馨易用验证，依用户要求未运行旧版全量回归。

## Next step

保留审校为离线观察工具，暂不做自动放行门，也不因此增加线上等待。下一步优先验证生成侧的表达关系：先在候选草稿中明确保留用户自己说出的两侧顾虑及其条件，再生成具体区分，避免完整event复制替代两难整理。关系仍是模型候选，Host只校验原话/引用与状态边界，不认证语义；无明确两难、只想记录时不强填。继续以本批漏报和合理对照验收，不把更多审校禁词或模型自评分当修复。该生成侧新契约目前not started，需先冻结再评估；1.1/4.1仍in progress、4.2 not started，整体4/10，无需用户重新配置Key。
