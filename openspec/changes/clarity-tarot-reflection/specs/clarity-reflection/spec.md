## Purpose

让用户从一句日常表达开始，得到贴着具体经历的回应，自主决定继续、停下、是否梳理及保存。需要梳理时帮助辨认解释、感受、期待、顾虑与未知；只想说说或留住片刻也完整成立。r5聚焦倾听与困扰纵向切片，保留片刻和旧选择兼容，不承诺重决策或三场景全部升级。本期不含塔罗。

以下r5产品行为是待实现目标，不代表旧线上已满足；明确标为旧flow或隔离实验的要求保持其版本边界。公共flow/schema与保存记录格式分别管理，不因行为升级重写历史记录。L01–L09的实施取证以acceptance.md为准。

## ADDED Requirements

### Requirement: Original material and provisional understanding ownership

r5 policy2 SHALL 将原话保全与模型候选理解分开，沿用七字段schema2并将策略版本绑定请求票据和响应应用。Host SHALL 保留完整生活原话，剔除交流控制和历史问答，允许本人修改、移除和恢复；模型event和内部goal SHALL NOT 被当作给本人呈现的理解。模型非event候选 SHALL 保持可见，不以details隐藏新推断后总确认；超容量整体拒绝而非裁文或降组。纯倾诉、仅记原话及尚无理解 SHALL 保持正常。

#### Scenario: Event-only review
- **WHEN** 模型在明确成稿时只返回合法event摘录
- **THEN** 原回包与工作claim保持，页面如实显示原话且记录里暂无候选理解；不补写insight、不确认隐藏event、不据保存成功提升内容等级

#### Scenario: Multiple understandings and protected originals
- **WHEN** 同批存在多条合法insight，或受保护原话与新来源发生冲突
- **THEN** 理解原文与顺序保持，完整原话独立可回看；冲突保护原内容并标待核对，超三主文不隐藏候选或半应用

#### Scenario: Explicit preservation of original material
- **WHEN** 本人确认保存包含source块的记录
- **THEN** 明确说明所选原话与整理保存在本机，可在保存前移除；不保存问答/控制/Key，默认导出主文，附带details需另选；历史或手改记录不凭块ID重评语义

#### Scenario: Authorized negative-positive emotion wording
- **WHEN** 本人明确纠正X为Y，候选以有限支持的第一/第二人称否定X并肯定Y，且claim引用实际纠正source
- **THEN** 新v3 guard不把该否定句误作重新认定X，原始文字不归一改写；随后真实再次肯定X、错源及伪造event仍拒绝，不把有限规则宣称通用语义验证

#### Scenario: Accepted understanding is visible during reflection
- **WHEN** 合法reflect响应本批实际接受insight或tradeoff，且来源和请求仍有效
- **THEN** 对话页在原reply后呈现这批可能理解，不等到成稿才可见；不隐藏原reply、不增加确认步骤、不称本人已理清；失效内容不冒充当前理解，历史保留当时原文快照而不受后续手改回写

### Requirement: Direct and simple primary path

系统 SHALL 让首次访客直接输入表达，不要求先选主题、整理模式或模型服务。默认页面 SHALL 至多有一个高强调主动作，按钮名与行为一致；对话阶段不默认展示步骤导航、分类侧栏或逐条认可按钮组。必要的首次发送说明 SHALL 保持可读。

#### Scenario: First visit with default service available
- **WHEN** 访客首次打开页面且默认服务可用
- **THEN** 访客可直接输入并点击“开始聊聊”，无需理解厂商、主题或模式

#### Scenario: First visit without default service
- **WHEN** 默认服务不可用
- **THEN** 系统明确说明并提供“只记下来”，个人 Key 配置保留在设置中，不强迫访客先配置

#### Scenario: Simple conversation screen
- **WHEN** 用户收到一个待回答的问题
- **THEN** 当前屏保留相关的最近原话摘录、必要回应、一个问题与输入，主按钮为“发送”；较早历史和提前整理为次级动作

### Requirement: Voluntary expression and optional closure

系统 SHALL 允许本人只说说、拒答、尚未理清、不生成报告及不保存而正常结束；首页不新增必选模式。r5首个纵向切片聚焦倾听与困扰，片刻/只记一句保持真实能力，复杂选择升级后置。倾诉的当次价值不得以是否产生insight或保存替代。

#### Scenario: Listening without an assignment
- **WHEN** 用户明确说只想吐槽、不需要提问或分析
- **THEN** 系统具体承接已说内容，保留继续表达入口，不生成问题、分析段、行动或报告

#### Scenario: End without a record
- **WHEN** 本人明确要求结束且不保存
- **THEN** 系统取消当前请求、按明确丢弃意愿结束，不要求成稿、保存或评价，不追加模型调用

### Requirement: Versioned conversational continuation

新行为 SHALL 显式使用clarity-v3及公共schema liubai-clarity-2，与旧flow校验独立。普通reflect响应 SHALL finish=false，question可null，claims可空；只有明示成稿的review请求才接受整理finish=true，既有明示行动请求沿用独立授权且不覆盖正文。新版本不得根据候选形状猜测，也不得连带改写formatVersion2保存记录。

#### Scenario: No question and continued expression
- **WHEN** r5收到合法无问题、未成稿的短回应，用户继续写下一句
- **THEN** 页面仍可发送，续说归为普通表达，不伪造问题关联或标为纠正；不会因此变成报告

#### Scenario: More than three real answers
- **WHEN** 本人在材料和请求容量内继续第四次及后续真实问答
- **THEN** 来源关联保持完整，不因三条关联或三次回答拒绝、清空或自动结案

#### Scenario: Permission violation is not repaired into success
- **WHEN** 新行为候选的问题、显式分析claim或行动违反当前权限，或阶段组合不合法
- **THEN** 系统拒绝候选并保留原文，不隐藏违规部分、补固定问题或自动重试来宣称合规；字段检查不认证reply所有隐含解释

### Requirement: User-owned conversational permissions

系统 SHALL 区分只倾听、禁止追问、希望理清、明确成稿和真正结束，从本人明确非引语的交流要求与合法操作派生策略并绑定请求快照。最新有效要求优先；模型mode/goal/finish和客户端自由权限字段不得替代用户意愿。控制语句不得混为生活记录。

#### Scenario: Listening is not stopping
- **WHEN** 本人说不用分析、还想继续说
- **THEN** 倾听偏好持续生效，不因“不分析”停止、强迫只记一句或生成整理；本人明确改变要求后才更新策略

#### Scenario: A quoted instruction belongs to someone else
- **WHEN** 用户转述别人说“别问了”或“不用分析”
- **THEN** 系统保留说话者归属，不自动禁止本人当前交流或结束会话

#### Scenario: Thinking together does not request an artifact
- **WHEN** 用户想一起理清，但未明确要求生成一份整理
- **THEN** 系统可给有来源的区分及必要的一问，继续对话，不自动转成品或宣称已理清

### Requirement: Truthful conversation and persistence states

系统 SHALL 分开本轮响应完成、候选整理可呈现、本人认可、实际保存及自愿体验反馈。模型结束状态不证明情绪改善或问题已解决。暂停/取消为正常选择，服务失败单独显示；模糊离开保留内容或提示丢弃，只有明确不保存结束后才清理，不自动持久化原始对话。

#### Scenario: Pause while waiting
- **WHEN** 用户暂停或取消正在等待的请求
- **THEN** 原文和草稿仍在，晚响应失效，不显示红色上游失败、不补发或自动总结

#### Scenario: Saved but still unresolved
- **WHEN** 用户保存一份仍保留未知的候选整理
- **THEN** 系统只确认本机写入成功，不因此显示本人已理清或已经被理解

### Requirement: Capacity-aware graceful closure

系统 SHALL 在生成前分别检查原始表达、问答关联、active claims、实际路由完整请求/输出以及本地记录容量。新行为继承12条原始表达窗口及可信路由边界，不静默截取旧来源、清空关联或抬限。容量不足不表示本人已经理清，也不等于会话调用次数上限。

#### Scenario: Model context does not fit
- **WHEN** 完整输入或claims超出可信请求容量
- **THEN** 系统不发该生成请求，保留已输入全文并说明容量状态，提供本地收尾及完整文字保留路径，不丢早期事实

#### Scenario: Local storage cannot hold the record
- **WHEN** 本地整理受记录容量或存储异常限制
- **THEN** 原文/修改留在本页，可完整下载文字；不得裁短后假保存或清理未保存内容

### Requirement: Layered formative and novice evidence

交付 SHALL 分开模型筛选、完整真实链路、两人形成性研究、五名新人无指导验收及自愿存储任务。原型/脚本/协助明确标注，形成性两人不抵正式五人数；至少4/5独立开始、继续及选择收尾作为项目主线门槛。保存找回的4/5功能证据单列，不强迫留隐私，数量不足标为未验证。内容可信与本人被听见/自主感不得由保存率或模型分数代答。

#### Scenario: Voluntary no-save choice
- **WHEN** 新人自行完成表达与交流，明确选择结束不保存
- **THEN** 不计为不会保存或主线失败；存储功能仍待独立证据，可另行同意使用合成记录验证

#### Scenario: Two-person direction discovery
- **WHEN** 两位参与者用明确标注的原型、脚本或稳定入口进行方向研究
- **THEN** 记录真实卡点和自愿反馈，仅用于该范围判断，不宣称r5真实模型、五人验收或疗效已通过

### Requirement: Goal-directed conversation

系统 SHALL 在本人愿意梳理时围绕一个可修正的当前关注点组织对话，每次最多一个主要问题且可不提问；问题须对应真实未决缺口及当前权限。旧goal、问答槽位和来源关联不得被当成用户已经回答、认可或理清的证明。系统 SHALL 允许更新关注点、自然纠正、拒答、继续表达和自主收尾，不以固定轮数或出现期待自动结案。

#### Scenario: Distinguishing observation from interpretation
- **WHEN** 用户说朋友两次取消约定并猜测对方不想见面
- **THEN** 系统具体承接已说的经历，在允许梳理时区分观察与猜测，允许追问且仍有实际缺口时才问具体互动或期待；不确认第三方的内心动机

#### Scenario: Already answered question
- **WHEN** 用户已经明确下一次安排的期待
- **THEN** 系统不再同义重复索取期待，可具体承接、保留未知，在允许追问时才询问另一真实缺口；只有本人明确请求成稿时进入整理，不将期待清楚当成会话完成

#### Scenario: Application chooses the concern gap
- **WHEN** 经过已经补充、但真正介意的部分尚不明确
- **THEN** 系统可选择一个有来源的澄清问题，不要求按经过/介意/期待的固定题序推进；已有答案或明确禁问时不补固定问题，真正停止优先取消请求，不自动整理

#### Scenario: The model misformats an application-owned question
- **WHEN** 明确使用旧clarity-v2的困扰候选仅在下一问元数据处不合规，已验证上下文中的旧应用计划仍需补充一个缺口
- **THEN** 应用使用自己的问题、目标和实际材料ID构造下一问，再执行同一候选校验；被覆盖的模型问题不是事实证据，不进入记录；顶层形状、模型正文与claims的来源校验不能因此放宽，其他场景仍使用原规则，不能据此凭空完成报告

### Requirement: Bounded waiting and measurable response time

系统 SHALL 在提交后立即显示真实等待状态；等待10秒后只更新状态文字，不伪造模型进度，不提前展示未经校验的JSON片段。客户端 SHALL 对完整请求及响应体读取设置60秒截止，超时保留用户原话并允许手动重试或本地整理；此截止不是聊天轮次或费用上限。取消、结束、先整理与完成 SHALL 清除计时器，晚响应不能写回新请求。

模型参数 SHALL 仅按已核实的精确型号配置。百炼`qwen3.8-2.4t-a95b`使用`reasoning_effort=low`且不尝试关闭思考；`deepseek-v4-pro-0813`使用`enable_thinking=false`。未知型号不通过名称前缀推断能力，不自动换模型或付款来源。

#### Scenario: Response body stalls
- **WHEN** 请求已发出但fetch或响应JSON读取持续挂起，甚至未响应取消
- **THEN** 客户端截止后退出等待、保留原文，不自动重试；用户可手动重新发送或先整理

#### Scenario: A stale request finishes after retry
- **WHEN** 用户取消后重新发送，旧请求随后返回
- **THEN** 旧结果和旧计时器不修改新请求内容、等待文字或焦点

#### Scenario: Completed generation has timing evidence
- **WHEN** 新版生成到达候选或失败结果返回阶段
- **THEN** 服务端通过固定Server-Timing字段记录准备、模型阶段、收尾及总耗时，日志只接受有界数字，不包含Key或原文；模型阶段包含来源复核与校验，不等同纯推理时间，诊断失败不能改变生成结果

#### Scenario: An invalid claim needs diagnosis
- **WHEN** 模型线索因形状、枚举、长度、来源或替换引用不符合契约被拒绝
- **THEN** 公开JSON仍保持原有invalid_claim/invalid_shape及字段；内部只记录固定错误类别，匹配失败可通过X-Liubai-Validation技术响应头给出该固定类别，不展示到产品界面、不包含候选、实际字段值或ID；诊断回调抛错或拒绝不改变结果，不延迟等待或触发再次调用

### Requirement: Grounded warmth and visible progress

系统 SHALL 用用户提供的具体细节、投入、影响或顾虑承接表达；本人希望梳理时，再用有依据、可修正的区分、取舍或未知提供帮助。只想倾诉时无需制造洞见、行动或问题，不能以泛夸、固定安慰或连续问卷填空。有问题时 SHALL 自然连接当前材料，不展示模型内部思考过程；不确定的感受与动机保持不确定，纠正优先。

#### Scenario: Acknowledging a specific investment
- **WHEN** 用户说为了见面留出两个周六，而对方取消后没有重约
- **THEN** 回应承接已付出的时间；允许梳理时区分计划落空与后续不确定，允许追问且仍有实际缺口时才问哪部分更在意，不直接断言对方不重视用户

#### Scenario: Conflicting concerns emerge
- **WHEN** 用户说希望对方主动重约，又怕提出期待像催促
- **THEN** 在允许梳理时，系统把两份顾虑连成有来源的理解，同时允许追问且确有缺口才问一个问题；不代其决定沟通或终止关系，不用完整event或引用ID抵消理解段漏掉一侧

#### Scenario: No need for another question
- **WHEN** 已有材料足以说明本次区分与未知
- **THEN** 系统可不再提问并继续保留表达入口，不为凑三问或五次点击继续索取；可让本人自主结束，明确要求成稿时才呈现整理

#### Scenario: An interest opener is not a concern
- **WHEN** 用户只询问是否知道某人物、作品或兴趣，尚未提供具体困扰
- **THEN** 系统先简短承接题面，可以问一个想聊的方面，不推断用户的介意或试探心理；使用现有moment作为暂存承接，claims为空且不直接形成报告，只有明确具体经历后才进入相应梳理

### Requirement: Provisional understanding and correction

系统 SHALL 将模型理解作为候选，在内部区分用户陈述的经历、想法、感受、在意、选择和未知。用户 SHALL 能自然纠正或在最终稿修改，不必逐轮认可；最后一次总确认可确认可见主文。用户修订 SHALL 优先于模型候选；来源标识合法不得被宣称为语义正确的保证。

#### Scenario: User corrects a need
- **WHEN** 用户把“希望提前沟通”改成“更希望主动提出新时间”
- **THEN** 后续草稿保留该修改，相关旧解释标为待重看，模型不得静默覆盖用户用词

#### Scenario: Confirmation is not external verification
- **WHEN** 用户认可一段经历的记录
- **THEN** 系统只表示记录符合用户表达，不标注为经过独立核验的客观事实

#### Scenario: Explicit emotion replacement
- **WHEN** 用户明确用完整句“不是失落，是生气”纠正当前感受
- **THEN** 后续候选采用生气；完全匹配的对照句只在引用真实纠正来源后归一，不能补证据；引用他人的原话及感受随时间变化不自动视为纠正

#### Scenario: A stale emotion quoted in an event
- **WHEN** 用户明确纠正感受后，收尾event精确摘录或前缀重建重新带入被否认的本人感受句
- **THEN** event与其他候选执行同一既有纠正检查并拒绝该结果，原始材料保留，不为此自动重试或改写成新的感受

#### Scenario: Nested quotations keep speaker attribution
- **WHEN** 被否认的情绪词出现在嵌套的第三方引号内，或外引号结束后才出现本人旧感受
- **THEN** 引号内内容保持原文且不视为本人的感受纠正；引号结束后的本人表达仍执行原纠正检查，不能因内层引号提前闭合而改写或误判外层内容

#### Scenario: Event excerpt keeps occurrence scope
- **WHEN** 用户分别说明本次临时加班并发抱歉表情、上次家里有事
- **THEN** 困扰收尾的事实段选择完整用户原句及对应来源，保留原顺序；不得把抱歉表情改写为两次都有；原句校验不代表认识或未知部分已通过语义验证

### Requirement: Scenario-appropriate output

本人选择成稿时，系统 SHALL 按实际内容组织片刻、困扰或兼容的选择记录。明确请求梳理的困扰及选择样例须有材料支持的具体区分、取舍或信息缺口；只倾诉、片刻或材料不足时不得强造洞察。r5不以困扰切片证明复杂选择升级，报告不得为填模板重复段落或增加场景。

候选成品 SHALL 最多三块主文，保留必要经历、顾虑、区分与未知，缺块不填。采用“目前的整理 / 一点可能的理解 / 还留着的问号”等候选语气，不因模型finish自动宣称“这次分清了”。额外经过按需展开，必要事实与感受、未确认推断及关键限制不得藏起。

#### Scenario: Concern report
- **WHEN** 用户表达朋友取消约定的经历并明确请求整理成稿
- **THEN** 候选区分事件、解释、期待和未知，具体关系可被本人修正；未获本人认可时不表示已经认可，不以复述及安慰代替请求的梳理

#### Scenario: A non-strict provider splits a concern finish into more claims
- **WHEN** 供应商完成困扰整理时返回4至6条线索，且每条原始字段、枚举、来源及替换引用均通过同一严格校验
- **THEN** 应用可将事实事件、个人感受与理解、未知合并为最多三条候选；感受不得并入会被原句摘录重建的事实段，多条事实被重建而丢掉所选内容时拒绝；不截断文本、不删除非法字段、不补来源、不绕过长度/重复/保护编辑检查；其他场景、非数组或超出容量保持拒绝

#### Scenario: Decision report
- **WHEN** 兼容选择路径的用户讨论课程与休息、提供可考虑的单次体验并请求成稿
- **THEN** 成品按照个人标准展示选项、代价与缺失信息，不凭空量化胜负，不把询问信息写成已决定报名

#### Scenario: Pleasant memory
- **WHEN** 用户只想保留一次散步的舒服片段
- **THEN** 成品可以短至片刻和意义两节，不强迫寻找矛盾或给出行动任务

#### Scenario: Recording instruction is not the memory
- **WHEN** 用户提供短片刻并明确只保留一句、不需要分析
- **THEN** 系统保留要记录的原话及原始来源，独立交流要求不写进正文；引号中的叙述不被当成操作要求删除

### Requirement: Explicit first-expression verbatim recording

系统 SHALL 在全新会话的首次表达中，对句末或换行后独立、明确且位于末尾控制句组内的原话记录要求，直接在浏览器创建本人原话草稿，不依赖AI状态、Key或模型回复。该路径 SHALL 不发送生成请求、不增加模型尝试、不伪造AI消息或候选；本人仍须确认后才写入本机记录。正文保留原有内部换行与标点，控制语不进入保存正文，原始输入只留当前工作会话。

该规则只处理明确交互语法，不推断用户情绪或需求。只有“不需要分析”、记录要求位于引用/转述中、未清晰分隔的命令与叙述、歧义或不平衡引号、正文中间另有控制语、已有会话/模型尝试/手改或移除内容时 SHALL 不自动切入本地路径。正文中的合法引用仍原样保留。AI原有七字段、来源校验及240/480字符边界不变；本地原话继续遵守4000字符输入边界，不按模型单段容量截断。

#### Scenario: Keep one expression before AI is ready
- **WHEN** 全新会话输入正文并在末尾单独要求只想保留原话，即使AI状态仍在加载或服务不可用
- **THEN** 唯一主按钮显示“只记这句话”，说明不发送给AI；点击直接呈现原话供确认，生成请求与模型调用均为零

#### Scenario: A quoted or ambiguous request
- **WHEN** 记录指令处于引号中、逗号引出的转述中、非末尾位置，或正文中间还有独立控制句
- **THEN** 不自动截取或删除正文，维持原有路径，不将词句命中当作语义判断

#### Scenario: An explicit request contains no words to keep
- **WHEN** 首次输入只有原话记录要求而没有正文
- **THEN** 页面提示先写下要保留的话，不建立记录、不发送生成请求，当前输入保持可修改

#### Scenario: Existing conversation is protected
- **WHEN** 会话已有表达、问题、候选、手动编辑、移除段落、待返回请求或模型尝试
- **THEN** 首次表达的本地规则不得替换该会话或清空已有内容，保存和恢复继续遵循原保护规则

### Requirement: Explicit action choice

系统 SHALL 仅在用户明确请求时提供模型生成的行动建议，并说明具体内容；用户自己提出的打算可直接纳入。行动 SHALL 为可选择、可修改的尝试，不能声称已经替用户执行。

#### Scenario: Optional message wording
- **WHEN** 用户选择“帮我想一句怎么说”
- **THEN** 系统提供符合其修正后期待的话术，允许不放入记录，且不发送给第三方

### Requirement: Retain the material that explains the concern

困扰收尾 SHALL 回看全部用户材料，在现有三块与容量边界内保留解释困扰所必需的经过、具体投入或影响、同时存在的顾虑及后来明确的期待。原本对他人意图的猜测不得因自己的期待变清楚而升级为事实。材料没有提供的环节 SHALL 留白；纠正与停止要求优先，不为套用链条强造两难。合法来源ID不能单独证明正文保留了相应内容。

#### Scenario: Investment and competing concerns survive the final report
- **WHEN** 用户补充具体投入，随后同时表达想问清与担心催促，最后明确需要什么安排
- **THEN** 模型候选及合并保存后的可见主文均保留必要投入、两份顾虑和有依据的区分，不以分栏复述或泛泛安慰代替

#### Scenario: One accepted batch contains complementary claims
- **WHEN** 同次收尾中两个通过校验且真正接受的候选属于同一展示组
- **THEN** 主文保留两者的互补内容及来源关联，不只取末条；收尾为完整候选，缺席的组不从历史模型条目补回；手动编辑及拒绝替换所涉及的已确认可见块继续保留，冲突仍须重新核对

#### Scenario: A concern is withdrawn
- **WHEN** 用户明确撤回先前顾虑或只想保留一句
- **THEN** 收尾遵循最新表达，不为材料覆盖要求复活旧顾虑或补写分析与建议

### Requirement: Offline versioned working-material selection

句级引用离线实验 SHALL 与生产入口隔离，索引只表示当前工作材料的精确原句、来源及UTF16范围，不把模型的事实/猜测/需要分类当成Host事实。引用 SHALL 与完整请求快照绑定；原文、来源类型、修订、问题关联或已知工作状态改变后，旧快照不得编译。摘要是身份标签，不是权限令牌；已有状态机的锁与晚响应检查继续生效。

私有选择协议 SHALL 独立版本化，不能混入公开七字段响应。模型只选择原句ID，Host编译event原句并派生公开来源ID；分析与未知仍为待确认候选。在v1（liubai-material-selection-1）中，虚构、重复、乱序或超容量选择、额外字段及非法替换引用 SHALL 拒绝，不能靠排序、截断、补来源或旧前缀重建改变选择。可支持的明确感受纠正只复用既有同源正向原文映射，并保留原始范围与投影范围。v1历史拒绝记录不得被v2的新语义覆盖。

该实验当前仅支持受控concern/review场景，不接管片刻、选择、行动、稀疏未知、历史独立停止/不分析要求或无法安全投影的纠正。未支持场景 SHALL 明确返回不支持，不等同生产行为被移除。引用合法 SHALL 不被宣称为语义涵盖、原猜测仍成立、条件完整或报告有用。真实模型、同步Runtime适配及公开元数据归一未验收前 SHALL 不接入生产。

#### Scenario: Selected original sentences stay selected
- **WHEN** 离线模型选择当前快照内的完整原句ID
- **THEN** 编译结果保留所选句子及实际来源，不因前文过长而改成全材料前缀；公开候选仍通过原严格校验，任何编译后候选被重写或移除都拒绝

#### Scenario: Working material changes while hashing
- **WHEN** 调用方在异步摘要期间修改输入，或将旧引用用于新修订/新会话
- **THEN** 一个索引只使用await之前捕获的同一快照；重新编译以当前快照重建索引并拒绝旧绑定，实际保存仍执行请求ticket和真实锁检查

#### Scenario: A legal reference accompanies a wrong interpretation
- **WHEN** 程度夸大、条件写成决定、已撤回猜测恢复或他人感受归本人，但引用本身合法
- **THEN** 工程编译结果只标识语义未验证；设计负对照不得计为内容成功，也不得用词句/ID命中代替语义评审

### Requirement: Isolated asynchronous material preparation

Host SHALL 在计费预留前完成异步材料快照准备及完整transport请求容量校验。准备结果 SHALL 捕获同一context/profile并绑定同步Runtime契约，调用方不能以run参数覆盖材料或校验器。公开body和env SHALL 不能开启私有实验协议；默认生产入口没有实验导入。

私有v1九字段或显式v2三字段响应 SHALL 先由已选择的绑定编译器生成合法公开七字段候选，仅成功结果归一公开schema元数据，不泄露私有引用trace。不能按模型响应形状自动切换协议。实验请求的精确内容 SHALL 进入账本digest。准备、解密、摘要、来源复查之后且预留之前已取消的请求 SHALL 拒绝；已派发的取消可能计费，晚响应仍不得应用。

#### Scenario: Caller changes the snapshot or model profile
- **WHEN** await期间原context/profile被改动，或run传入另一context/contract/profile
- **THEN** 准备只使用捕获快照，run不能覆盖绑定；profile不符时在模型派发前拒绝，由实际生命周期检查决定旧快照是否仍可运行

#### Scenario: Cancellation or source change during preparation
- **WHEN** 材料准备、密钥解密、摘要或来源复查等待时请求被取消，或默认源改变
- **THEN** 已知取消和源变化在预留前拒绝，模型不派发；输入超容量或不支持场景同样不预留

#### Scenario: Controlled live finalization evaluation
- **WHEN** 在隔离预览使用固定H06/H03/H08合成材料各进行一次收尾
- **THEN** 保留成功和失败的原输出与实际用量，不自动重试；协议、保存与语义分别验收，不将受控concern收尾称为场景路由、完整对话或真人体验通过

### Requirement: Host-owned material sets and review metadata

显式v2（liubai-material-selection-2） SHALL 只接受reply/title/claims三个模型字段。受控concern/review的mode、非空goal、question=null和finish=true SHALL 由已冻结Host上下文构造；模型不能选择这些元数据。insight/unknown保守标为inferred，不把该标签当语义正确。event原句由Host组装，模型不得提供正文；不强制凑满insight或用内心归因替代有材料支持的具体区分。

v2的anchorIds SHALL 采用集合语义：先拒绝未知、重复、不可选及非法替换引用，再按原文索引顺序组装同一完整成员集合，不截断、不新增、不丢弃或按文字去重。内部trace SHALL 同时保留模型原数组序与组装序，不向公开候选或用户记录泄漏。v1仍拒绝乱序，不作自动降级或修补。

三字段raw SHALL 不被宣称能独立证明快照、模型或请求归属。真实调用的归属由绑定generate Promise、Runtime与实际ticket控制；离线回放 SHALL 先核对Host记录的requestId、协议、context指纹、profile及完整请求，再调用同一绑定编译器，不能把裸raw重新绑定到任意快照后声称防重放。

#### Scenario: The model returns a differently ordered reference set
- **WHEN** v2选择相同的有效且不重复的原句ID，但数组排列不同
- **THEN** Host组装相同完整原文并记录两种顺序；v1同一乱序输入仍被拒绝，原失败证据不改写

#### Scenario: A source set accompanies a new inner explanation
- **WHEN** 模型引用真实投入却补出未表达的需要、动机或性格，或给计划加无依据的进退评价
- **THEN** 引用成功不能计内容通过；语义评审按全部title/reply/claims及实际保存正文判断，不靠关键词或引用数认证理解

#### Scenario: Four-turn synthetic evaluation resumes
- **WHEN** 隔离评估逐轮发送固定合成表达
- **THEN** 后续只接受Worker签名、绑定run/case/step/expiry的上一真实state，不能让任意context或claims进入模型；每步固定requestId由原账本去重，调用前持久attempt，提前结束或问题不符就停止，不伪造历史问答

### Requirement: Visible retention of short working material

独立v3实验 SHALL 从当前原话、UTF16范围、来源摘要、会话/revision及实际问题/回答关系派生不可变材料ledger，不另建重复数据库、不使用旧模型正文补材料。问题关联只表示交流来源，不证明回答的语义分类。previous ledger仅供Host观察变化，不是历史真实性或授权认证；原文编辑、移除、重排、版本复用或缺少修订历史 SHALL 令旧引用失效并要求重看，不猜测自然语言的全部撤回依赖。

v3 SHALL 由Host固定组装全部active短原话为公开event，标签继续是“你说过的”，不能称已独立核实的事实。每条240、总计480上限保持，超容量在模型和计费前明确不支持，不截断、抬限或悄悄去重。模型仅能输出0–2条有依据的insight/unknown，不得选择漏掉哪句event、引用retired材料、重写原话或指定替换元数据。v1/v2历史协议与失败记录保持。

窄明确感受纠正 SHALL 复用既有词表、匹配和正向原文后缀，仅退休实际较晚纠正所针对的完整、独立、第一人称肯定感受句或已证明的旧纠正投影。问句、否定、第二人称及混合事实不能按候选拒绝匹配直接退休；不安全时原文保留且实验拒绝。退休按出现顺序单向应用，A→B→A不得复活最早来源；kind=correction不等于语义撤回证明。

候选包含全部原话 SHALL 不被宣称为实际可见或保存成功。已知edited/confirmed在v3准备前排出scope；wire不可见的stale+locked、用户移除、手改与晚响应继续由真实state保护。固定新批次只替代旧模型候选、不作语义反驳，不能从历史条目补正文。apply后 SHALL 核对实际可见原话块，用户移除/编辑或needs_review不得自动恢复或计为覆盖成功。仅保存总确认后的可见正文，不额外保存ledger、原始问答消息或退休历史。

#### Scenario: The last generation omits a known concern or expectation
- **WHEN** 短材料中已经表达了感受、同时顾虑及条件期待，但模型本轮分析没有复述它们
- **THEN** active原话仍由Host完整进入可见原话块，并验证实际保存读回；这只证明材料保留，不把重复或错误分析算成有用拆解

#### Scenario: A prior emotion is mixed with a fact
- **WHEN** 较早句子为“我很失落，也迟到了半小时”而后来明确改为生气
- **THEN** 不得退休整句丢掉事实，也不得裁剪从句制造新引用；ledger保留原句并明确不支持本次实验

#### Scenario: A protected or removed block conflicts with automatic retention
- **WHEN** 实际state拒绝固定event替换、已有context被用户主动移除，或手改使旧响应过期
- **THEN** 用户文本和移除决定保留，覆盖检查返回needs_review/user_removed/stale而非成功，不强制恢复原话；原有保存权限与stale保护继续生效

#### Scenario: Native v3 evaluation uses a signed continuation
- **WHEN** 在隔离环境用固定合成材料验证真实v3输出
- **THEN** 使用独立版本label、签名域及请求/会话ID，不能接受v2续步或与其幂等身份冲突；原生JSON直接编译并与API候选对照，围栏或旧协议不映射救活；Worker与客户端分别apply并检查可见正文及内存保存，语义与首次用户体验单独判定，实验入口不进入生产

#### Scenario: Scene uncertainty is separated from question provenance
- **WHEN** 隔离reflect策略处理具体经历、兴趣、片刻或选择的首轮表达
- **THEN** 场景由材料及当前意愿判断，不因第三方意图未知就默认片刻，不由fixture或关键词路由强制困扰；所有模式的问题仍须引用非空真实原话，修正来源不等于证明场景或问句正确

#### Scenario: Analysis preserves the user's degree and unresolved object
- **WHEN** 用户只否定极端说法，或仍在弄清是否如此、哪个选项、程度或原因
- **THEN** 模型分析不得把非禁止加强为肯定意愿/许可，也不得把未决对象偷换为原因；原话保留或引用合法不能抵消title/reply/analysis的语义偏移，旧版本真实失败保持可追溯

### Requirement: Provisional relation plan preserves selected sides

隔离concern/review生成实验 SHALL 使用独立四字段私有协议，在同一候选中选择active材料的两侧引用并写理解。focus可为null，不强填两难；非空时raw及compiled同一insight SHALL 字面包含两个独立引用、证据覆盖两侧。Host SHALL 保留来源与全部UTF16匹配、拒绝重叠或未解决歧义，不取first认证归属，不将非法focus静默降成null。

公开候选、完整原话、长度/时长、保护与保存边界 SHALL 保持，focus只入实验trace、不入用户candidate或记录。引用覆盖 SHALL 不被当作两侧有意义、限定完整或理解有用的证明；null也不证明没有遗漏。选错两句、裁掉否定或仅拼引用的合法反例 SHALL 在语义评审独立失败，不能借审校空结果放行。

#### Scenario: One source sentence contains both sides
- **WHEN** 同一active原句含想保留的目标与已表达的担心
- **THEN** 允许同anchor选择两个可定位独立片段，raw及compiled理解均保留两侧；整句上下文继续供人工核对，不以不同ID数判断有效

#### Scenario: Literal selection remains provisional
- **WHEN** 两引用在源与insight都存在，但片段裁掉否定或只有并排复述
- **THEN** 机械结果仅标字面覆盖未核语义；原材料保留，逐例内容评审不得算作有用拆解通过

### Requirement: Isolated semantic audit observations

离线语义审校 SHALL 使用独立私有schema，仅对Host固定的review两难连接、reflect提问预设、首轮knowledge明确题面回应作窄范围观察。输入 SHALL 包含不可变原context、实际候选与task，候选/来源/模型版本改变时旧快照失效；不能改写被审对象、把评审答案送入模型或以用户数据切换职责。

findings SHALL 引用Host文字字段与精确原话，保留全部匹配位置；Host只机械核对形状/路径/引用，不将其当语义真值。合法引用的错误控告仍可通过格式，空findings仅为未检出；失败、超时、未适用分别记不可用，不能计内容成功。观察 SHALL 不含公共用户candidate，不改state、确认、保存或自动补发，生产API/记录路径保持隔离。

#### Scenario: Literal references do not prove an omission
- **WHEN** 审校引用了合法原话与候选片段，但整体其它分析已表达相应两难
- **THEN** 格式可被验证，语义误报仍须在独立正反例中记录，不自动拒绝或修改用户候选

#### Scenario: No finding and unavailable audit remain separate
- **WHEN** 模型返回空findings、非法引用或超时
- **THEN** 分别记录未检出或不可用，都不认证内容合格，缺陷检出和误报由独立语义评审验证

#### Scenario: Audit is not a user candidate
- **WHEN** 私有审校Runtime完成并形成观察
- **THEN** 返回completed/audit与独立schema，不返回可应用的公开candidate，不调用用户状态推进、保存或自动改写

### Requirement: Faithful dialogue scope and open inquiry

隔离承接策略 SHALL 保留用户所述的范围、程度、对象和条件，不从愿意参与推出不介意额外负担，不从介意一项推出排除另一项。已有材料不足以形成区分时 SHALL 允许准确并列，不能要求每轮补出洞察。标题 SHALL 用具体事项定位，不能因压缩而将时间影响加强为另一个事件结果。

问题 SHALL 补充真实未知，沿用已明确的目标及标准；比较信息的答案可以支持、反驳或与当前猜测无关。未由本人提出待检验关系时，不定向索取支持某选项好处的正例，也不重复确认已说清的兴趣目的。既有Host停止、问题来源、公开schema与Runtime校验边界保持；这些提示词 SHALL 不被宣称为语义验证器。

#### Scenario: Participation and burden remain simultaneous
- **WHEN** 本人愿意共同参与，又表达额外安排的实际影响
- **THEN** 系统保留两者，不替本人排除对额外负担的介意；原话和引用完整也不能抵消承接中排他结论的语义偏移

#### Scenario: Comparison question permits disconfirmation
- **WHEN** 本人比较两个选项，尚不知道某项因素对自己的影响
- **THEN** 下一问补充比较所缺的信息，不将该因素有益作为前提只找正例；不靠句式词或模型自评分证明问题开放

#### Scenario: Known interest and title scope persist
- **WHEN** 本人已明确兴趣方向或表达某件事的时间被挤占
- **THEN** 系统不重复询问已知方向，不将时间受影响简写为该事情没有发生；逐句内容验收与格式校验分别记录

### Requirement: Host-scoped duration surface provenance

隔离个人复盘实验 SHALL 由Host固定purpose，不能让模型通过modeId自行豁免。可识别的小时/分钟原形 SHALL 在原生候选所有文字字段和规范化后候选分别检查，保留完整源span及限定，不换算、加总、删句或改数值。源unsupported在模型和计费前退出，新增/unsupported输出不得进入状态或触发自动重试。

此检查 SHALL 明确标注仅duration_surface_forms_only，semanticTruth/attribution未核。相同原形不证明当前值、事件/他人归属、每次与总计、条件或心理解释正确；知识scope由Host另行声明not_applicable，不可算检查通过。有限文法之外的覆盖边界和误拒必须进入证据，不宣称全语言事实验证。

#### Scenario: A plausible but invented duration is returned
- **WHEN** 原话为两次各半小时，而reply/title/goal/question或claim出现无源的两小时
- **THEN** 新个人检查拒绝候选，保留原文和原始失败，既有规范化不能先删掉该字段来绕过检查；不替用户改成正确合计或自动重试

#### Scenario: The same surface belongs to another event
- **WHEN** 错误归属或错误总量仍使用源中已有的同形时长
- **THEN** 原形检查可通过，但结果保持语义/归属unverified，内容评审仍应独立失败，不提升为事实正确

### Requirement: Recoverable review and truthful saving

选择留存的用户 SHALL 能编辑候选草稿、移除恢复及返回前文；“确认并保存”一次完成可见主文的总确认与本机写入，存储成功不表明已经理清。整理与保存均为可选，未确认推断不得藏起自动通过。编辑控件按需出现；默认导出与主文一致，完整细节需另选，不携带原始对话、密钥或内部提示词。

#### Scenario: One confirmation and save
- **WHEN** 用户认可短整理并点击“确认并保存”
- **THEN** 系统直接尝试本机保存，不要求再点第二个保存按钮；只有写入成功才显示已保存

#### Scenario: Local save fails
- **WHEN** 本机存储写入失败
- **THEN** 系统保留草稿与修改，说明未保存并提供重试，不显示成功状态

#### Scenario: Material is ready
- **WHEN** 本人明确请求成稿，当前回复形成通过应用检查的候选整理
- **THEN** 系统直接呈现候选及一次确认保存入口，仍可继续说或结束不保存；仅材料齐全、无问题或模型finish不能替代本人的成稿请求

#### Scenario: Remove every section
- **WHEN** 用户移除最后一节
- **THEN** 用户可恢复移除内容或手写新段落，不需要重新开始会话

#### Scenario: Revise upstream material
- **WHEN** 用户回到之前步骤修改表达
- **THEN** 系统保留当前草稿与手动编辑，标示受影响的理解待重看，不自动发送新的模型请求

### Requirement: Bounded explicit requests and failure recovery

系统 SHALL 仅在明确发送、明示请AI生成整理或主动请求建议时调用模型，沿用来源、配置版本、计费与并发约束。过期响应不得写回，不自动重试或静默截断修订。正常暂停/停止不表示模型失败，也不追加调用；容量或服务失败不阻止本地保留。既有“先整理”本地动作保持零调用，新的AI成稿动作须明确区分。

#### Scenario: Local actions cost no requests
- **WHEN** 用户确认、回看、编辑或将现有草稿整理成页
- **THEN** 模型调用数不增加

#### Scenario: More than five attempts
- **WHEN** 新版用户在同一体验中已发送或重试五次，继续明确提交
- **THEN** 前后端不因会话次数拒绝；仍检查来源、并发、单次容量、重复请求及组织者共享配置，不清空历史计费记录

#### Scenario: Paraphrased event at review
- **WHEN** 其他候选字段和来源通过检查，但事实段改写了原句
- **THEN** 应用可从真实用户材料按原顺序构造完整句摘录和实际来源，保留已验证结构的分析，不额外付费重试；不能容纳完整句时保留原话并说明失败

#### Scenario: Response arrives after an edit
- **WHEN** 旧版本请求在用户修改内容后返回
- **THEN** 旧响应不覆盖当前内容，当前输入和手动修订保持完整

#### Scenario: Provider failure
- **WHEN** 模型调用失败或额度用尽
- **THEN** 系统说明真实状况并提供保留已有内容的路径，不把固定示例伪装成生成结果

### Requirement: Bounded candidate formatting

系统 SHALL 只在有文档依据的精确模型别名上启用严格结构化输出，约束字段、条数、已有来源ID及收尾形式；未知自选模型保留通用协议。供应商结构化输出 SHALL 不替代平台来源、长度、状态及内容验收，不放宽单次容量边界，不自动重试。

#### Scenario: Supported structured output
- **WHEN** 新版契约调用已适配的结构化模型
- **THEN** 请求保留输入及输出容量上限；收尾不含新问题，未授权行动不出现在可选类型中，响应仍经过平台校验

#### Scenario: Four valid concern parts
- **WHEN** 收尾恰有event、feeling、insight、unknown各一条且逐项校验通过
- **THEN** 系统可将event与feeling原文合并并保留全部来源及替换关系；合并后仍受三条、单段及总长度限制，不截断或补写

#### Scenario: Missing evidence
- **WHEN** 某段来源缺失、来源虚构或输出有禁止字段
- **THEN** 系统拒绝候选，不通过格式整理补造来源；用户原稿仍在，不自动追加付费修复

### Requirement: Accessible and evidence-backed delivery

系统 SHALL 在窄屏与键盘操作中提供可读正文、可见焦点和不被遮挡的主要动作，并尊重减少动态偏好。交付说明 SHALL 区分设计样例、结构测试、真实模型结果及用户反馈；不得用其中一类证据替代另一类。

默认界面 SHALL 采用一套叙事字体与常规功能字体、三档基础字号（24px 页面标题、19px 当前问题/正文/输入及主要按钮、14px 节标签与必要辅助说明），尊重用户缩放；不得为适配首屏缩字或隐藏重要信息。问题用常规字重、颜色与间距区分，成品只强调一个核心认识，其余段落用间距组织。信息预算作为设计目标，不裁剪用户原话或必要的不确定性。

#### Scenario: Narrow screen
- **WHEN** 用户在 390px 宽度使用对话及报告
- **THEN** 文字及操作无横向溢出，单列输入不被遮挡，提前整理和修改操作无需悬停；200% 字号放大后仍能完成主线

#### Scenario: Synthetic preview
- **WHEN** 固定脚本用于展示流程
- **THEN** 预览清楚标注为虚构设计示例，不能宣称线上模型已经实现同等质量

### Requirement: Independent beta records and entry

小范围内测 SHALL 通过独立`/clarity`入口提供，标明内测身份，沿用既有默认服务与管理认证。新版记录 SHALL 使用独立存储位置，旧页面的保存/删除不能覆盖新版记录；新页面不得改写旧版原始记录。正式首页切换仍需完整内容与用户验收。

#### Scenario: Alternating old and new pages
- **WHEN** 同一浏览器保存新版记录后，仍已打开的旧页面再次保存或删除
- **THEN** 新版记录保持完整，旧版原始存储只受旧页面自己的操作影响

#### Scenario: First new record snapshot
- **WHEN** 新版存储尚不存在但旧版有记录
- **THEN** 新版可读取旧版记录，在首次新版保存或删除时形成独立副本；之后两边不自动同步

#### Scenario: Empty or corrupt new storage
- **WHEN** 新版存储已经是空数组，或包含损坏数据
- **THEN** 系统不得回退旧存储而复活删除记录或掩盖错误；写入失败不修改旧存储、不报告成功
