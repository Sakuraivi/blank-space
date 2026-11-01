# 完整示例的配对生成对照

状态：示例与单变量策略 completed，固定实测 in progress；尚无真实输出结论。沿用 clarity-tarot-reflection，整体4/10，1.1/4.1 in progress，4.2 not started。生产与UI不变。

## 冻结的责任与变量

上一批 relation-plan 同时调整私有结构和指令，不能单因果归咎字段。本轮恢复三字段基线：baseline 直接调用 prepareFaithfulDialogueReviewRun，examples 使用同一准备器，只在 instruction.text 末尾增加固定三组完整合成示例。元数据 policyVersion 分别为 clarity-faithful-dialogue-review-1 / clarity-example-review-1；实际 prepareProviderRequest body 除 system 消息 content 外逐项相同，examples 的 content 必须严格等于 baseline content 加 EXAMPLE_REVIEW_BLOCK。

保留私有 liubai-material-retention-3、公开 liubai-clarity-1、相同输入与当前材料索引、旧编译与时长检查、生命周期、状态应用及保存规则。没有 focus 字段、第二次审校、JSON围栏修补、来源裁切或结果后补发。示例不得混入当前材料；只示范有依据的关系、单一信息缺口、非拒绝不等于承诺。示例中的 m 编号只是该合成例的局部编号。

三个示例在 ai/experiments/clarity-review-examples.mjs 固定为合唱换声部、公园饮水点、播客录制，材料与 reply/title/claims 完整；它们是人工教学内容，不是原生模型证据、测试金标或用户记录。三组都以真实旧编译器重建材料并验证合法性，独立人工审阅忠实性；不以编译通过认证语义。例文删去一个可能补出性别且重复 unknown 的末句后冻结，所有真实输出之前完成。

## 预先固定的运行与评判

沿用 relation-plan 的8份 concern/review context，全部已被实现者和评审读过，旧 known/fresh 标签只是历史来源；本轮全部称已知回归样本，不是新盲测。三组教学示例未复用这8例的独特内容。两臂材料、模型及请求约束相同，只有完整示例块变化；例文和策略不得按这轮真实结果修改。

每例 baseline/examples 各一次，共16次预注册尝试。0-based偶数例 B→E，奇数例 E→B；这是平衡顺序，不是随机实验或缓存效应消除。每臂从同一原 context 独立重建 session/ticket，使用带 run/case/arm 的独立 request ID，互不读取对方输出。单臂失败照常进入下一项，不重试、不换输入、不补固定未来回答、不重跑失败批次。

仍用默认 bailian / deepseek-v4-pro-0813 / revision3、原12000B/2000输出token约束及真实API计费/幂等；示例会增加实际输入token、费用及潜在时延，分臂记录，不称成本相同。固定16是实验长度，不是产品聊天上限或开发总费用上限。现有未定价配置金额如实记未知，不猜0元。

执行前冻结策略与例文，再冻结完整harness和源摘要。运行前持久化计划，每次POST前再落盘；记录实际provider body、原生内容、合法性、API candidate、实际apply、有效原话可见、内存save/JSON读回。默认Key只由真实Worker内部使用，不读取或输出Key。保留失败原貌，解析失败与编译拒绝分开统计。

人工逐项比较 reply/title/insight/unknown 与原材料：

- 是否连起明确的目标与担心，而非选偏或只并排复述；单信息需求不强造另一份顾虑。
- 是否保留条件、程度、期待主体、未知对象和明确否定；不把非拒绝加强为愿意或已承诺。
- 是否新增心理过程、持久压力、第三方动机、行动建议或示例内容；event原话完整不能抵消分析错误。
- 是否自然、简约、便于阅读；引用/格式/保存通过不等于拆解或温馨感通过。

每臂每例标 narrow pass / partial / fail / unavailable，再逐对标 improved / tied / regressed / incomparable，引用具体原文与输出支持判断。无可用candidate不得剥围栏后计内容通过。评审由独立agent逐句执行，作者身份披露；不是盲评、用户体验或统计显著性证明。这批只能判断已知受控收尾是否值得进入完整对话验证，不能独立授权发布或勾完4.1。

## 真实前的证据

策略/例文先冻结1735564；真实调用前core6+harness6共12项新定向、54项相关继承链检查、严格规范、独立源码审阅与两种Worker dry-run通过。生产dry-run 142.08KiB/gzip36.27KiB，实验317.43KiB/gzip74.74KiB。8组实际完整请求最大9546B/12000B，输出2000token约束不变。

真实handleApi+内存DB/stub provider测试有16条finished/candidate及16次独立保存读回，实际顺序4对baseline先/4对examples先；故意首臂失败、候选篡改、落盘失败、原生围栏失败均有定向检查。这些合成stub仅证工程，不是内容成功。执行关键摘要覆盖例文/core、继承compiler/guard、完整harness、测试、plan及package；准备最终源冻结后再运行真实批次。

## 发布边界与后续

不改生产API、flow、Key、模型配置、预算、口令、域名、D1结构、UI、字体或用户记录；只有合成测试记入正常用量。结束停止远程预览，核对精确16个请求账本、生产HTTP和100%部署版本。按用户要求不跑旧版全量回归，仍做新模块、相关继承链的定向检查、构建及独立审阅。

若示例改善，下一步只把已证明部分接入完整对话验证；若未改善，保留失败证据并重新评估生成路线，不继续叠规则宣称完成。无需用户重填Key；首次无指导体验仍not started。
