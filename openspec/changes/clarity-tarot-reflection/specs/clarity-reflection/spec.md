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

#### Scenario: Event excerpt keeps occurrence scope
- **WHEN** 用户分别说明本次临时加班并发抱歉表情、上次家里有事
- **THEN** 困扰收尾的事实段选择完整用户原句及对应来源，保留原顺序；不得把抱歉表情改写为两次都有；原句校验不代表认识或未知部分已通过语义验证

### Requirement: Scenario-appropriate output

系统 SHALL 根据片刻、困扰和选择组织成品。困扰及选择的正常完成样例必须呈现一个有依据的区分、取舍或待验证事项；材料不足时 SHALL 明示未决，不伪造洞察。报告不得为了填满模板重复段落或增加场景细节。

默认成品 SHALL 只呈现最多三块主文，连接必要经历、起初的解释/顾虑、本次区分及仍未知的信息；额外经过与选项对照按需展开。困扰主文可采用“让你卡住的 / 这次分清了 / 还留着的问号”。简化不得把解释认识所必需的事实和感受全部收起，不得隐藏未确认的新推断或会改变判断的限制。

#### Scenario: Concern report
- **WHEN** 用户完成朋友取消约定的完整脚本
- **THEN** 成品区分事件、解释、具体期待和未知，并保留被认可的认识，而非只有事件复述及安慰

#### Scenario: Decision report
- **WHEN** 用户讨论课程与休息并提供可考虑的单次体验
- **THEN** 成品按照个人标准展示选项、代价与缺失信息，不凭空量化胜负，不把询问信息写成已决定报名

#### Scenario: Pleasant memory
- **WHEN** 用户只想保留一次散步的舒服片段
- **THEN** 成品可以短至片刻和意义两节，不强迫寻找矛盾或给出行动任务

#### Scenario: Recording instruction is not the memory
- **WHEN** 用户提供短片刻并明确只保留一句、不需要分析
- **THEN** 系统保留要记录的原话及原始来源，独立交流要求不写进正文；引号中的叙述不被当成操作要求删除

### Requirement: Explicit action choice

系统 SHALL 仅在用户明确请求时提供模型生成的行动建议，并说明具体内容；用户自己提出的打算可直接纳入。行动 SHALL 为可选择、可修改的尝试，不能声称已经替用户执行。

#### Scenario: Optional message wording
- **WHEN** 用户选择“帮我想一句怎么说”
- **THEN** 系统提供符合其修正后期待的话术，允许不放入记录，且不发送给第三方

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
