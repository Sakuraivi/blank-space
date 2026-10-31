# 小范围语义审校实验

状态：私有协议与10项定向检查 completed、独立源码审阅通过，隔离harness与20项新定向检查 completed，真实审校 not started。沿用`clarity-tarot-reflection`的质量评估任务；1.1/4.1 in progress、4.2 not started，整体4/10。生产、界面、字体与组织者配置不变。

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

## Pre-run evidence

core10项检查通过，包括原候选不变、task范围、全部UTF16匹配、私有completed无用户candidate、未知/改述引用拒绝、合法假控告不被认证、恶意来源隔离、pre-await快照、取消/晚响应无重试。已知8份真实候选严格校验与可信transport通过，最终最大7491B/12000B；当时新6例正文未读。独立源码审阅及严格规范校验通过；已修复非字符串task经JS键强制转换绕过scope的漏洞并补反例，此时真实审校调用0。

策略冻结于`e3ef58e34f7c84ab9023f245d389398aae2ff3ce`后root才读新6例并映射最终fixture，原独立文件SHA256 `fe36fd068cc29525caf9548d887267ec1e93342671d4c542b798f9723cab5633`。正文/候选/期望未改，未根据新例调词。14个严格input准备通过，known最大7491B、fresh最大4895B。

core10+harness10共20项通过，包括真实handleApi+内存SQLite/合成加密配置/stub provider的14行finished/completed、0candidate/started，不调用应用状态。另17项相邻对话检查、生产Worker构建dry-run、严格规范通过；没有旧版全量回归。独立harness审阅发现响应捕获中止/无独立截止的问题，补初始及订阅后abort检查、最多10秒独立读取截止、空chunk界限与失败时取消原body，防止后续adapter继续读挂住的body；3项新增边界测试及实际API账本fallback通过，仍无真实模型调用。

默认服务只读status200仍为百炼DeepSeek0813/revision3。审校completed在原通用diagnostics中归other，实验必须按独立label/requestId和精确账本分开记录，不混作用户candidate成功率。最终独立源码复核通过；实验Worker dry-run复查187.75KiB/gzip45.25KiB通过。现在待最终源码冻结，再做真实14例及语义误报/漏报评审，运行前记录保留。
