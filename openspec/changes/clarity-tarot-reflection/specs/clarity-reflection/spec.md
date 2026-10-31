## Purpose

让用户围绕一次具体经历，通过具体承接和有目的的追问辨认自己的解释、感受、在意与选择，并形成有来源、可修正、保留未知的个人整理。系统支持轻量记忆、困扰梳理和选择权衡，避免把温柔复述当作已经理清事情。本期不包含塔罗交互。

## ADDED Requirements

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

### Requirement: Goal-directed conversation

系统 SHALL 以一个当前目标组织对话，每次最多提出一个主要问题，问题须对应尚未回答的信息缺口；用户已明确的目标不重复询问。系统 SHALL 允许修改目标、跳过问题和提前收尾。

#### Scenario: Distinguishing observation from interpretation
- **WHEN** 用户说朋友两次取消约定并猜测对方不想见面
- **THEN** 系统区分这两类材料，追问具体互动或当前期待，不确认第三方的内心动机

#### Scenario: Already answered question
- **WHEN** 用户已经明确下一次安排的期待
- **THEN** 系统不再用同义问句重复索取这个期待，并允许整理或转向一个不同且有价值的缺口

#### Scenario: Application chooses the concern gap
- **WHEN** 经过已经补充、但真正介意的部分尚不明确
- **THEN** 应用选择聚焦介意点的问题，模型不能改为让用户比较虚构回应；已有明确在意点时跳到期待，明确停止时直接整理

#### Scenario: The model misformats an application-owned question
- **WHEN** 困扰候选仅在下一问元数据处不合规，已验证上下文中的应用计划仍需补充一个缺口
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

系统 SHALL 用用户提供的具体投入、影响或顾虑承接表达，并通过可修正的区分、取舍或矛盾推进当前问题；不能以固定安慰、连续问卷或冗长解释替代这一作用。用户可见回应 SHALL 解释材料与下一问的简短联系，不展示模型内部思考过程。不确定的感受和动机 SHALL 保持不确定，用户纠正时立即采用。

#### Scenario: Acknowledging a specific investment
- **WHEN** 用户说为了见面留出两个周六，而对方取消后没有重约
- **THEN** 回应承接已付出的时间，暂时区分计划落空与后续不确定，询问用户哪部分更在意；不直接断言对方不重视用户

#### Scenario: Conflicting concerns emerge
- **WHEN** 用户说希望对方主动重约，又怕提出期待像催促
- **THEN** 系统辨认这两份顾虑，并用一个问题帮助其说清期待，不直接替其决定要沟通或终止关系

#### Scenario: No need for another question
- **WHEN** 已有材料足以说明本次区分与未知
- **THEN** 系统可直接整理，不为凑足三问或五次点击继续询问

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

系统 SHALL 根据片刻、困扰和选择组织成品。困扰及选择的正常完成样例必须呈现一个有依据的区分、取舍或待验证事项；材料不足时 SHALL 明示未决，不伪造洞察。报告不得为了填满模板重复段落或增加场景细节。

默认成品 SHALL 只呈现最多三块主文，连接必要经历、起初的解释/顾虑、本次区分及仍未知的信息；额外经过与选项对照按需展开。困扰主文可采用“让你卡住的 / 这次分清了 / 还留着的问号”。简化不得把解释认识所必需的事实和感受全部收起，不得隐藏未确认的新推断或会改变判断的限制。

#### Scenario: Concern report
- **WHEN** 用户完成朋友取消约定的完整脚本
- **THEN** 成品区分事件、解释、具体期待和未知，并保留被认可的认识，而非只有事件复述及安慰

#### Scenario: A non-strict provider splits a concern finish into more claims
- **WHEN** 供应商完成困扰整理时返回4至6条线索，且每条原始字段、枚举、来源及替换引用均通过同一严格校验
- **THEN** 应用可将事实事件、个人感受与理解、未知合并为最多三条候选；感受不得并入会被原句摘录重建的事实段，多条事实被重建而丢掉所选内容时拒绝；不截断文本、不删除非法字段、不补来源、不绕过长度/重复/保护编辑检查；其他场景、非数组或超出容量保持拒绝

#### Scenario: Decision report
- **WHEN** 用户讨论课程与休息并提供可考虑的单次体验
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

### Requirement: Recoverable review and truthful saving

系统 SHALL 提供最终草稿编辑、移除恢复与返回前文；“确认并保存”一次完成可见主文的总确认和本机写入。未确认的新推断不得藏在折叠区后自动通过。编辑、移除、恢复控件只在用户主动进入编辑时呈现。默认导出 SHALL 与主文一致，完整细节需另选，不自动携带原始对话、密钥或内部提示词。

#### Scenario: One confirmation and save
- **WHEN** 用户认可短整理并点击“确认并保存”
- **THEN** 系统直接尝试本机保存，不要求再点第二个保存按钮；只有写入成功才显示已保存

#### Scenario: Local save fails
- **WHEN** 本机存储写入失败
- **THEN** 系统保留草稿与修改，说明未保存并提供重试，不显示成功状态

#### Scenario: Material is ready
- **WHEN** 当前回复已获得足够材料且应用检查通过
- **THEN** 系统直接呈现短整理及“确认并保存”，不额外要求点击进入整理页；用户仍可再聊一句

#### Scenario: Remove every section
- **WHEN** 用户移除最后一节
- **THEN** 用户可恢复移除内容或手写新段落，不需要重新开始会话

#### Scenario: Revise upstream material
- **WHEN** 用户回到之前步骤修改表达
- **THEN** 系统保留当前草稿与手动编辑，标示受影响的理解待重看，不自动发送新的模型请求

### Requirement: Bounded explicit requests and failure recovery

系统 SHALL 仅在明确发送或请求建议时调用模型，沿用服务端来源、配置版本、计费与并发约束。过期响应不得写回新版本；不自动重试或静默截断用户修订。已达到调用上限或失败 SHALL 不阻止编辑和保留已有内容。

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
