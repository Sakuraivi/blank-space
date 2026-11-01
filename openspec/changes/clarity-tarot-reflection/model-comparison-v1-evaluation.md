# 固定E条件的候选模型对照 v1

状态：5.4 completed，筛选结论No-Go。官方能力、实际账户推理、固定24格、独立机械与逐句语义审阅均完成；没有合格候选，不切换默认模型、不认证新Host或发布。任务清单8/19，r5清单4/9（3项本地工程＋1项筛选），不是质量或成熟度百分比。以下执行契约在真实前冻结为29e4983；结果只追加于后文。

## 唯一请求变量与候选

固定旧实验E的三组完整合成示例、8个已知concern/review context、私有三字段 `liubai-material-retention-3` 与现有编译/校验；直接调用未修改的 `prepareExampleReviewRun`。不把新clarity-v3倾听协议混入该筛选，不修改提示词、材料、解码方式或输出长度。参考与候选仅实际JSON body的 `model` 不同，其余字段逐项相等。24份真实完整body已离线核验，最大9546B，原可信12000B与2000输出tokens不变。

| arm | 请求的精确model ID | 责任与官方核验 |
| --- | --- | --- |
| reference | deepseek-v4-pro-0813 | 当前默认型号的同批参考，不借用上次8例输出。官方[模型页](https://docs.bailian.console.aliyun.com/zh/model-studio/deepseek-v4-pro)列出精确快照 |
| max | qwen3.8-max-0902 | 待测质量候选；官方[模型页](https://help.aliyun.com/zh/model-studio/qwen3-8-max)确认固定快照及2026-09-02别名 |
| flash | qwen3.8-flash | 待测效率候选；官方[模型页](https://help.aliyun.com/zh/model-studio/qwen3-8-flash)确认精确型号，名称不证明更快或足够好 |

2026-11-01已核验官方[深度思考文档](https://help.aliyun.com/zh/model-studio/deep-thinking)与[Chat参数文档](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)：候选Max快照与Flash支持关闭思考。现有三个可信路由均发送system/user、stream=false、enable_thinking=false、max_completion_tokens=2000，不发送response_format；继续json_text及Host校验，不启用官方虽支持的strict schema。页面支持不是账户权限或实际遵循证据。

本轮排除qwen3.8-2.4t-a95b：官方不同页面对关闭思考仍有不一致，现有适配不在本轮改动范围；不为增加候选修改生产参数或换端点。

## 账户、权限与隔离

真实前只读核对：组织者配置为bailian / deepseek-v4-pro-0813 / manual / revision3 / enabled，call_limit与shared_budget_micros均NULL；查询rows_written=0，public status可用。该status不证明候选能推理。100%部署基线为b45bb156-f01e-4345-9723-9cf5aec6cc2c，对应Worker d49f5c96-b8a0-4195-8404-b65561c73524。

实验Worker仅在限时远程预览执行，入口供本机4199使用，不绑定域名、不发布稳定Worker。请求仅接受预注册case/arm、空POST及run header，拒绝自定义prompt/model/endpoint、查询串及外部身份头。Key不交给客户端、不读取本地明文或环境凭证、不导出Key；仍由真实API在Worker内部按原流程使用。

候选通过实验env.DB的只读行视图映射精确organizer配置SELECT：先验证真实来源仍是冻结的默认型号/manual/revision3/enabled/NULL limits，仅改该次读取的model_id，其余密文/IV/revision/限额原样保留。持久配置不写，来源重查、幂等、并发、真实账本、安全停机和45秒运行截止保留；不为实验抬限、清账本或绕过异常停止。账本记录实际请求型号，手工价格未知仍记金额未知。

每个arm的第一个FULL请求同时作为实际账户推理核验，归入24个槽位，不另加重复probe。若该请求上游返回400/401/402/403/404/422/429等预检拒绝，保留原失败与用量，该arm后续槽位标skipped_after_preflight_rejection且不发送；不改参数、换型号或重试。仅明确的鉴权/模型不可用/权限/额度reason才作相应归因；一般400/422可为参数拒绝，429可为瞬时限流，不据此断言账户无权。后7格未测要如实说明。200响应的JSON/编译失败属于比较结果，不能伪装权限不可用后跳过。请求型号与成功响应returnedModel分开记录，滚动别名/可选缺失元数据不冒充固定底层版本。

## 固定运行与审阅门槛

共8个已见回归context×3模型，每格至多一次、24次预注册。三个arm逐case轮转顺序；每arm在三个位置各出现2或3次，并非随机或缓存效应消除。所有arm在各自调用前都从同一原context独立重建，不拿别臂输出当输入，不补固定未来回答。先落盘完整计划，再在每次POST前落盘；未落盘不派发。

保留实际provider body、原生content/finish_reason/returnedModel及可用usage、API结果、编译拒绝、actual apply、全部有效原话可见、独立内存format2保存和JSON读回。原生围栏/无效JSON不修补；传输失败不补发。工程步骤完成、原文完整或可保存都不能抵消分析偏移。完整JSON payload、来源与上下文、策略/示例/源码摘要先冻结，再执行真实批次；不按本批结果改规则。

逐例审阅reply/title/insight/unknown：

- FULL的可保存理解主文须明确连起“想保护学日语时间”与“怕拒绝后见面尴尬”，不能以reply或event中的原话并列代替；整份可见结果保留先问能否接、没空另找办法、不退出及还没谈过的范围，不把本周特定两次照做泛化为习惯。任一侧/条件/否定出错独立失败。
- 其余案例分别核对休息与家庭理解、具体反馈不等于标签结论、核对柜号的不便与范围、可靠猫照护的前提、同事自主与重要节点核对、单一报名日期、未拒绝不等于答应。单信息缺口不强造两难。
- 不新增心理过程、第三方动机、行动承诺、程度或示例材料；感受和未知对象不漂移。审阅自然、简约、是否有实际区分，不以文风讨喜代替忠实分析。
- 每格pass / partial / fail / unavailable，候选相对同批参考另记improved / tied / regressed / incomparable；需具体来源与输出引句。8例全已知、每格一次、非盲评/非真人，不宣称统计显著性或泛化能力。

候选仅在可用、FULL各独立门槛通过且其余案例无关键新增偏移时，才可建议进入新Host完整链路验证；这不等于允许改生产默认服务或发布。无合格候选则记录No-Go与明确替代，不自动叠提示词或把复述降格当梳理合格。

## 执行前检查与后续记录

能力核验、24份真实请求单变量与输入快照、真实API/内存账本及客户端故障边界共22/22新增定向通过（core4 / worker9 / live9）；继承E的12项相关检查通过。实验Worker本地dry-run为277.84KiB / gzip72.02KiB，严格OpenSpec通过；未跑旧版全量回归。独立机制审阅未发现阻断，追加的安全停止分支也有实际定向覆盖。源码冻结、原生结果、精确账本、独立语义/机械审阅与生产核对将按实际完成追加；未完成项不提前宣称。

## 实际执行与机械审计

完整源码冻结29e4983f6e25eb7f24733656635e54b4c1dcaf82，源树干净；run m20261101models1a于2026-11-01 05:20:52–05:23:43 UTC执行。24次预注册请求全部派发，24份原生JSON，23份公开candidate实际apply/全部有效原话可见/独立内存保存与JSON读回；reference FULL唯一一次以invalid_analysis_claim拒绝。无自动重试、补发、跳格、围栏修补或结果后调词。

精确24ID账本全部finished，分模型字段/outcome/usage一致；238项独立机械检查通过。34项工作树源摘要逐字节一致；与Git冻结blob相比22项字节相同、12项仅Windows CRLF/LF不同，统一换行后34项均匹配，未当作源漂移。本批reference的8份实际body与历史E臂逐字段且序列化字节相同；旧FULL曾可用、本批结构失败，属于本次观察，不能借旧结果补票。

完整原生输出、34份摘要、实际state/保存、精确账本及两份独立审阅已持久化至[评测证据](../../../ai/evaluations/2026-11-01-model-comparison-v1.json)。原live SHA256为a18934bc7727e80f05a71334aeae7867af76a0fef84d75a6344f99b6bfbd8e9b；19条来源引句与49条输出引句均重新定位核对。机械审阅者为Worker作者、非客户端/fixtures作者，已披露；语义审阅者未写固定E或新生成器，但参与能力/机制审阅，非盲评。

## 内容结果与筛选决定

| 已知案例 | reference | Max0902 | Flash |
| --- | --- | --- | --- |
| 花箱FULL：学习时间／拒绝尴尬 | unavailable | fail | fail |
| 周末休息／陪爸爸 | pass | pass | pass |
| 标签具体反馈 | pass | pass | pass |
| 柜号核对与时长范围 | pass | pass | partial |
| 外地交流／可靠猫照护前提 | pass | partial | fail |
| 同事自主／重要节点核对 | pass | pass | partial |
| 单一报名日期 | pass | pass | pass |
| 未拒绝调岗／尚未答应 | pass | pass | pass |

reference为7 pass＋1 unavailable；Max为6 pass＋1 partial＋1 fail；Flash为4 pass＋2 partial＋2 fail。相对同批可用reference，Max为6 tied/1 regressed/1 incomparable，Flash为4 tied/3 regressed/1 incomparable；没有靠可用性改善强排FULL的语义优劣，不是品牌排名。

FULL中，Max的理解主文提到愿意照看、先问及怕尴尬，却遗漏保护学习时间这一侧；Flash保留学习时间，却遗漏怕拒绝后见面尴尬。完整event均含原话，仍不能抵消可保存理解段的核心关系遗漏。Max另把“照护未落实”收窄为“还没找到可靠的人”；Flash将照护前提挂到申请而非愿意前往，并新增尚未前往的状态，另有时长范围丢失与未知任务新增。

reference FULL的第二条原生insight明确写出“我想留住学日语的时间，也怕拒绝后见面尴尬”，但第一条也为insight，触发旧编译器同类型唯一约束。该格保持原生拒绝/unavailable，不合并条目或补成成功；这证明的是冻结协议下未交付可用结果，不能推导模型没有该内容能力。Max/Flash的合法FULL则是实际关系选择未过，两类问题分开处理。

筛选No-Go：两个候选都未达到FULL独立门槛，不能进入已合格的新Host联调或直接改生产默认配置。23次保存、总分、文风与部分案例正确都不能抵消。

## 用量、时延与生产边界

| arm | 输入tokens | 输出tokens | 合计 | API中位ms | 客户端中位ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| reference | 14,187 | 1,245 | 15,432 | 5,295.5 | 6,629 |
| max | 14,068 | 1,030 | 15,098 | 6,007 | 7,709.5 |
| flash | 14,068 | 1,423 | 15,491 | 5,361.5 | 6,895 |

总输入42,323、输出3,698，合46,021 tokens；三个requestedModel与成功响应returnedModel均为相应请求ID。手工配置仍未定价，实际金额未知，不记免费；不同模型tokenizer使相同body产生不同输入token数。客户端含远程预览往返，API含准备/校验/收尾，均不是TTFT或纯推理速度；每格一次、顺序非随机，不能由此认定Flash必然更快。

初次预览health20秒超时为0模型调用，失败记录保留；显式指定--host blank.sakura.observer后health200，未改DNS或部署。批次结束关闭4199远程预览；前后组织者默认仍bailian/deepseek0813/manual/r3、NULL次数/预算，价格字段与100%旧部署基线均一致。clarity200、未认证后台401、生产health404、AI状态200；4195本地模拟预览仍200。没有配置/Key/口令/存储格式/数据库结构/UI/字体/用户记录修改，远程写入仅正常24条评测账本。

## 下一阶段替代路径

停止同条件补测或自动追加提示词。先离线区分语义问题与旧/新协议兼容：冻结reference FULL原raw，保留两条原句，检查新v3的字段、来源、明确成稿权限、完整payload与真实state边界。新v3没有旧同类型唯一限制，但旧raw仍缺新字段和明示review来源；任何Host映射必须标为反事实兼容探针，不是本批原生成功或新模型能力证据。不在本轮修改编译器、接入5.6或换默认型号。

并行的5.5两人形成性研究可用明确标注的原型，观察自主继续/停下/按需整理及什么内容才有帮助；目前仍0参与者。5.6真实新协议资格与完整联调、5.8五人验收、5.9发布均未完成。需要的用户配合是安排两名自愿体验者，不需要补Key；离线契约定位可以先独立推进。
