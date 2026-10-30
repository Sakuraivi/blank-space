# 留白 AI 接入契约

## 多服务商：版本5已发布

DeepSeek、Kimi、GLM、OpenAI已作为版本5发布，[正式AI设置](https://blank.sakura.observer/?settings=ai)已在浏览器显示四家选项和通用「API Key」，无需登录。以下版本3/2内容保留历史事实；当前设计与验收见 [multi-provider-ai](../openspec/changes/multi-provider-ai/design.md)，官方核验依据见 [provider-sources.md](provider-sources.md)。

发布源为`7f32ef7f178d169558b29ded3218833e9ef97ffa`；保存版本`appgprj_6ae36b991cbc8191b1da8189a33a0d1c~appgver_31656823cd508191835840cf80e599da`，部署`appgdep_6ae4b89599ac8191b327fb5cd1372393`返回`succeeded`，环境revision1。本次只已推送Sites原生托管仓库，不据此声称GitHub同步，也未迁至用户自管Cloudflare。

### 目录与传输所有权

`providers.mjs` 是服务商、模型、固定端点、参数能力、费率和保守预留的唯一目录。当前模型为 `deepseek-flash`、`kimi-k3.1-pro`、`glm-4.7-flash`、`gpt-6-luna`，每家只提供一款受控试用模型，不接受自定义端点或任意模型输入。

`provider-transport.mjs` 处理各家参数与受控错误。OpenAI使用developer消息、`max_completion_tokens`、关闭推理和`store:false`；DeepSeek及GLM使用各自关闭思考参数；Kimi使用low思考，2000 completion token上限包含思考用量。思考正文不显示、不记录。完整请求与响应受字节上限、超时和manual拒绝重定向限制，不重试或转发认证到其他目标。

每次生成仍由 `buildContext` / `buildModelRequest` 从服务端注入统一平台、模式及阶段规则；用户材料作为独立消息，Key、端点、费用来源不进入模型材料。`runCandidate` 与前端继续检查四字段候选、来源、长度、问题和行动许可。这些检查不能证明语义正确，四家须分别完成真实场景评测。

### 公开协议与会话绑定

状态协议为 `configVersion: multi-v1`、`consentVersion: multi-provider-v1`：

- `providers`：公开白名单，包含服务商id/label/keyHelp/defaultModelId与模型id/label/note。
- `defaultProfile` / `defaultAvailable`：实际默认服务商/模型及凭据就绪情况；没有默认配置时profile为null。
- `enabled`：个人路径的全局资格；`defaultEnabled` / `defaultReason`另检查共享预算。不能用共享次数耗尽禁用完整个人配置。
- `remainingCalls` / `remainingBudgetCny`：专指共享次数和保守预算余量，不是个人账户余额或供应商实际费用。

生成请求必须显式携带 `sourceMode: default|personal`、`providerId`、`modelId`、配置及同意版本，再带原有请求标识、revision、stage、session等字段。`personalApiKey`只在personal来源必填，不属于session。默认来源必须与当前实际默认路由一致；配置变化拒绝旧同意，不向新接收方静默发送。

响应的 `route:{sourceMode,providerId,modelId}` 必须与前端冻结快照一致，并通过会话、请求编号和revision匹配才可显示。route参与幂等摘要，Key及Key摘要不参与；复用编号更换来源或路由返回冲突。

前端设置保存服务商/模型/Key的原子配置，切换服务商清空新输入，取消不改变已应用值；已有Key不回填DOM。开始体验后冻结配置，`pagehide`清除设置和会话Key副本，BFcache返回不恢复或改用默认。错误按当前服务商标注；个人缺Key、认证、模型权限或余额失败均保留原话且不切默认。

### 默认服务、个人自费与账本

用户明确区分两种来源：

| 来源 | 资格与费用边界 |
| --- | --- |
| default | 原共享最多18次、保守预留合计不超过900000微元（¥0.90），另留¥0.10；按具体模型预留，失败不释放 |
| personal | 填写者自行付费，不占共享18次或金额，账本`reserved_micros=0`；不代表真实费用为0 |
| 两者通用 | 每会话最多5次、全局并发2次、单次材料/completion边界、同源、取消、异常用量持久停用与价格有效窗 |

`LIUBAI_DEFAULT_PROVIDER`指定四家之一，缺省deepseek；`LIUBAI_DEFAULT_MODEL`可省略，须为对应目录模型。默认Key只取相应 `LIUBAI_DEFAULT_<PROVIDER>_KEY`；只有deepseek可兼容旧D1已启用加密配置。其他服务商不会继承旧Key，公开个人入口不提供全局读写权。

`0001_rapid_shocker.sql`为schema-only追加迁移，新增`source_mode/provider_id/model_id/price_version/reserved_micros`。生产Sites数据库overview和rows已核对五列存在，旧两条fallback行保留`source_mode=default`和每行50000微元原预留，provider/model为null；default为兼容旧共享口径的迁移值，不推断旧请求实际凭据来源，也不追溯释放或重置批次。原子reserve同时检查默认来源次数/费用和通用5/2条件，换Key、模型或提供个人Key不绕过通用门禁。

默认按模型保守预留（当前Kimi400000微元，其余至少50000微元）；实际usage按所选模型费率及上限核验，越界记error并持久停用。美元折算是含缓冲的预算假设，非实时汇率或账单；价格有效窗仍截至北京时间2026-11-06 00:00，到期须复核。诊断仅包含受控状态、请求和白名单路由元数据，不含凭据、原文、供应商原错、模型正文或思考。

### 目前证据与待验边界

最新全量命令 **143/143通过**，其后代码未改变；OpenSpec严格校验通过，最终 `build-site` 构建退出码0。旧账本追加迁移测试通过，本地D1按starter文件执行方式成功运行五条ALTER；构建产物Worker在4173的`/api/ai/status`返回200、`multi-v1`、四家目录和`defaultAvailable:false`。

离线浏览器四家均取得模拟候选，GLM401时默认存在仍不切Key并保留原话，OpenAI纠正后可编辑整理并确认；活动会话锁定、切provider清输入、取消不改applied且Key不回填DOM已验。390视口文档宽375，无横向溢出；离页至无默认服务页再后退，Key为空、当前选择未配置。这证明该导航返回检查通过，未采集`event.persisted`，不据此宣称实际BFcache恢复事件已验证。

离线fixture六次模拟调用包括personal5次/default1次，个人预留均为0；共享余量18→17、¥0.90→¥0.85。此为独立测试数据库，不是生产使用量。此次未发真实推理请求，无本轮真实API费用；生产原两次失败不重置，实际账单仍未核验。

另一个独立4181慢响应fixture接收1次personal请求，预留为0。用户先取消转本地整理并改写；20秒后模拟后台记为finished/candidate，页面仍保留用户原编辑文本，未采用迟到候选。该case不并入前述六次fixture计数，也没有真实模型费用。

```powershell
node --test core.test.mjs public-flow.test.mjs personal-key.test.mjs ai-settings.test.mjs ai/*.test.mjs server/*.test.mjs
```

生产状态接口已返回200、`configVersion:multi-v1`、`consentVersion:multi-provider-v1`、`enabled:true`、四家目录；`defaultAvailable/defaultEnabled`均false、profile为null，共享剩余16次、保守预算¥0.80。此轮没有新增真实调用，生产账本仍为原两条失败记录。正式设置截图位于工作区`outputs/liubai-multi-live.jpg`。

实现、143项自动化、本地及生产迁移、上述浏览器检查、最终构建和版本5发布均已完成。四家真实可用性、输出质量、纠正效果、token用量及账单仍未验，不能以离线候选或发布代替；下一步使用可用官方账户由用户在页面自行输入Key，再做受控真实样例验证。

## 历史版本 3：公开设置与凭据选择

2026-10-30，用户已明确选择：访客填写个人 Key 时优先使用个人 Key；留空时使用组织者默认 Key。公开体验无需 ChatGPT 登录或体验码。新契约详见 [public-ai-settings](../openspec/changes/warm-public-ai/specs/public-ai-settings/spec.md)。版本 3 已发布到 https://blank.sakura.observer，最终 **93/93 自动化通过**、最终构建退出码 0、OpenSpec 严格校验通过。部署 ID为 `appgdep_6ae4a83fdebc8191ac2918a151b07cad`，发布源为 `4fd788f45bc2dea025f1b6bfcd1fa4d93a038380`；下方版本 2 只作历史保留。

- 首页公开设置和旧管理地址均进入当前访客的个人设置，不授予全站默认 Key 读写权。
- 个人 Key只在当前页面和单次后台请求内存使用，不进入存储、URL、日志、数据库、导出记录或系统提示词；刷新或离开页面后不恢复；`pagehide` 同时清除设置与本次会话中的个人凭据副本，BFcache 返回不会恢复它或静默改用默认 Key。设置保留不发起模型请求。
- 组织者默认 Key由服务端秘密 `LIUBAI_DEFAULT_DEEPSEEK_KEY` 提供；可兼容旧已启用加密配置。非空个人 Key不合法或供应商失败时不得自动切默认。
- 公开状态须分别表达个人支持、默认可用性、统一批次资格。所有来源共同使用现有 18/5/2 门禁，换 Key不重置额度；异常用量停用须同样约束环境默认 Key。
- 每次生成仍由后台构建相同平台规则与模式/阶段指令，用户材料作为独立数据消息，所有来源使用相同候选校验。
- 同意发送后才把本次材料及所选个人 Key经同源 HTTPS发给后台；后台只将 Key用于固定 DeepSeek端点认证，正文与 Key均不进入账本。
- 新旧全局管理 API继续受保护；本轮移除的是普通访客的登录和体验码门槛，不是把共享秘密设置权限匿名化。
- 真实默认或个人 Key尚未填写，真实供应商输出质量和账单仍未验证。离线 mock 和自动化不证明真实模型内容或费用。

当前公开协议使用 `configVersion: public-v1`、`consentVersion: deepseek-v1`。生成体中的 `personalApiKey` 是独立的可选传输字段，不属于 `session` 或模型可见上下文；公开状态分别返回 `personalKeySupported`、`defaultAvailable`、`sourceMode` 与批次余量。

当前调用链：

```text
浏览器：选择本地或 AI，个人 Key可选，明确同意发送
  → POST /api/ai/generate（个人 Key为可选传输字段，不进入 session）
  → 服务端校验同源/同意/材料，个人优先或默认来源
  → 服务端场景规则与用户材料分离组装
  → 同一 D1原子预留与固定 DeepSeek端点
  → 候选校验、迟到结果丢弃、用户编辑确认
```

本轮离线证据：API 31 项、适配器 12 项、账本 10 项共 53 项通过；全量 93 项通过。浏览器验证公开入口、个人假 Key 应用/清除及离开后返回、本地编辑确认和 mock 默认候选。默认路径调用/取消后剩余次数刷新为16/18；模拟个人 401 时前端明确不换 Key重试，保留原文，默认存在仍不切换。模拟20秒慢响应取消后修改总结，等待旧结果到达后内容不变。最终构建退出码 0、版本 3 发布 succeeded，且正式域名公开设置已验；没有真实模型费用。

生产匿名读取 `/api/ai/status` 已返回 200 JSON：`enabled:true`、`personalKeySupported:true`、`defaultAvailable:false`、`configVersion:public-v1`、`remainingCalls:18`、`inviteRequired:false`。此时用户可以填个人 Key，但尚无组织者默认 Key。旧 `/api/admin/status` 返回 403 JSON `admin_required`；它是应用授权结果，与历史 Node 公网边缘 403 区分。

真实模型验证仍待用户自行填写个人 Key，或组织者通过托管秘密项配置 `LIUBAI_DEFAULT_DEEPSEEK_KEY`。设置保存与公开状态读取不调用模型，首次真实试跑才计入同一批 18 次。

本轮任务与当前状态：[warm-public-ai/tasks.md](../openspec/changes/warm-public-ai/tasks.md)。下方保留版本 2 的详细契约和验证历史，其中“必须体验码”“体验者不填 Key”“公开管理页依赖 ChatGPT 登录”等描述由当前版本 3 的公开契约替代。

## 历史版本 2（v0.2）

更新：2026-10-30。版本 2 已发布，部署状态 `succeeded`；DeepSeek 适配器、同源服务端、D1 额度账本、管理员 Key 页面和可选 AI 对话分支已实现，全量自动化 78/78 通过。D1 两张业务表已通过平台工具验证。线上验收尚未全部完成；真实 Key 未填写，真实模型能力和账单未验证。

## 已确定的产品与费用边界

朋友打开网站后可使用本地模式；AI 体验需填写组织者的体验码并明确同意发送给 DeepSeek。API 费用由管理员统一承担，体验者不填写模型 Key。

首轮固定 `deepseek-flash`，关闭思考模式，JSON 输出。用户预算为人民币 1 元以内：每次保守占用 ¥0.05，最多 18 次，共 ¥0.90，留 ¥0.10 余量。每会话最多 5 次、并发最多 2 次。每会话限制不等于每人身份配额；全批 18 次由持久账本独立限制。

完整上游请求最多 12000 UTF-8 字节，输出 `max_tokens=1000`，响应最多 128 KiB。报价假设采用 2026-10-30 核验的高峰缓存未命中输入 ¥2/百万 token、输出 ¥8/百万 token；有效期至北京时间 2026-11-06 00:00，到期拒绝调用。价格来源：[DeepSeek 中文价格说明](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。预留不是实际账单；真实账户可用性、计费统计及此保守估计仍待小样本验证。

对个人订阅的边界保持不变：不把当前 Codex 登录转成公共模型代理。远程托管产品使用 ChatGPT 套餐需另行确认正式合作接入。[Codex app-server 认证边界](https://learn.chatgpt.com/docs/app-server#auth-endpoints)和 [SIWC 适用范围](https://developers.openai.com/siwc/token-sharing-open-source)支持这一判断。其他供应商和体验者自带 Key 仍为后续范围；本轮没有任意 URL 转发或多供应商切换。

## 每轮指令与材料组装

`buildModelRequest()` 每次组装平台规则、模式/阶段要求、单独的用户数据和输出契约；无需训练模型，也不依赖模型记住上轮规则。

- 固定规则：角色、表达边界、卡片用途、用户纠正优先，理解须可撤回。
- 阶段状态：开心片刻/心事/小选择，追问/整理，已问数量及是否允许行动建议。
- 用户数据：原话和纠正才是证据；实际问题、模型假设与反馈判定单独表示。
- 适配器：本轮映射为 DeepSeek `system` 与 `user` 两条消息；未来服务可使用其支持的 `instructions`、`developer` 或 `system`，不能仅换模型名就宣称兼容。

`POLICY_VERSION` 和 `SCHEMA_VERSION` 标记行为版本。提示词不是安全保证，JSON 模式也不能保证语义正确；仍须程序校验和独立场景评测。

## 调用链与所有权

```text
浏览器：用户选择 AI、同意发送、填写体验码
  → POST /api/ai/generate（原话、实际问答、纠正、请求标识和配置版本）
  → 服务端检查同源、同意版本、体验码、配置和材料大小
  → buildContext → buildModelRequest → 供应商请求上限检查
  → D1 原子 reserve（全批/会话/并发/重复请求）
  → DeepSeek 固定官方端点 → 完整 JSON 候选校验
  → D1 finish（状态、用量；失败也不退回占用）
  → 浏览器复验请求标识/版本/字段/来源，再显示候选
  → 用户修改并确认 → 本机保存或导出
```

`public/` 为前端源码；`app/api/[...path]/route.ts` 将路由交给 `server/api.mjs`。Vinext 构建为 Cloudflare Worker，D1 `DB` 提供跨请求持久状态；`dist/` 是输出。生产账本无内存回退。

程序拥有会话状态、请求标识、轮数、预算、超时与保存；模型只提供候选。模型不能标记 confirmed、选择 nextStage、调用工具或保存记录。

## 对话材料契约

`session` 保留故事、焦点、卡片联想和本地固定答案，新增：

```js
turns: [{ id: 't1', question: '实际问过的问题', answer: '用户回答' }]
feedback: [{ hypothesisText: '模型曾给出的理解', verdict: 'rejected', correction: '用户纠正' }]
```

- `turns` 最多 3 项，ID 为 `t1`–`t3` 且不重复；问题最多 120 字符，回答最多 3000 字符。
- 回答来源为 `u_turn_t1` 等。空回答不产生证据，但保留实际问题历史与已问数量。
- `feedback` 最多 6 项；`verdict` 为 accepted/rejected/uncertain，用户纠正最多 1000 字符，来源为 `u_feedback_1` 等。
- 问题、hypothesisText 及其判定属于上下文历史，不是用户证据；只有用户的纠正文本成为 correction。
- 抽到的卡片元数据不是证据；用户自己填写的卡片联想属于表达。
- 浏览器发送对象使用白名单，排除旧 review 和额外凭据字段；服务端再次从已知字段构建冻结快照。

请求体带 `requestId`、`revision`、`configVersion`、`consentVersion: 'deepseek-v1'`、`inviteCode`、`stage`、`allowNextStep` 和 `session`。同一 requestId 不重复调用；复用 ID 却更换材料会冲突。配置版本改变时需重新告知，不能静默换接收方。

## 候选与交互

四个字段都必须存在，允许为 null；非空项统一为 `{ text, evidenceIds }`。

| 字段 | 呈现与限制 |
| --- | --- |
| reflection | 根据表达整理，最多 320 字符 |
| hypothesis | 可能的理解，最多 200 字符，待用户修正或确认 |
| question | 至多一个问题槽位，最多 120 字符，仅追问阶段且未满三问 |
| nextStep | 可选小行动，最多 160 字符，仅整理阶段且用户主动允许 |

服务端与前端均检查形状、长度、来源存在性、阶段和行动许可。引用 ID 存在不等于语义支持；一个 question 字段也不证明文本中没有多个子问题。需要评测曲解、过度推断、纠正后仍暗示、卡牌心理判断、第三方动机和提示注入。

用户可选择“贴近 / 不太对 / 暂不确定”，纠正随下一轮发送，不额外发起一次计费。已明确否认的同文假设不再次展示或归档；换一种说法重复错误仍需语义评测。实际问题及答案一起保存于内存，避免画面问题和归档来源错位。

输入变化、返回修改、换会话、结束或新请求替换旧请求都会使旧回复失效。服务端推理限时 45 秒，浏览器等待限时 50 秒；取消上游和拒收迟到结果分别处理。返回修改前保留当前实际回答；已有用户编辑草稿不能被重试覆盖。故障回退仍保留原话，转本地时只继续三问范围内的剩余问题。

## 凭据与身份

管理员页面 `/admin.html` 通过 `/api/admin/status`、`/api/admin/config` 查询、设置、替换或删除 Key。当前 ChatGPT 登录复用 Sites 的管理员身份源，并非 DeepSeek 的要求；体验者不需此登录。首次用托管配置 `LIUBAI_BOOTSTRAP_EMAIL` 匹配站点所有者，之后按站点范围的稳定用户 ID 授权。线上已看到未授权提示，尚未验证所有者正向登录、首次绑定及配置操作。邮箱 OTP 等替代认证只是未来建议，本轮未实施。

`LIUBAI_SECRET_KEY` 是服务端的 32 字节 Base64 主密钥。API Key 使用随机 IV 的 AES-GCM 加密后存入 D1，后台不回传明文；体验码只存摘要。匿名访客不能读写管理配置。Key、主密钥和体验码不进入前端资源、Git、localStorage、提示词或错误响应。保存设置不会发起模型调用，不等于连接成功。

这些身份头由 Sites dispatch 提供；普通可直连 Worker 不能照搬这一信任边界。托管运行秘密通过 Sites 配置，`.env.example` 只记录变量名。缺失 DB、凭据、授权或价格有效期时保持 AI 不可用，本地记录继续可用。

## 额度和记录

D1 `pilot_requests` 在一个 SQL 写入中同时检查全批 18 次、每会话 5 次、并发 2 次并预留调用。幂等诊断读取不授予调用权。已调用后的取消、超时、供应商失败、无效结果均可能计费，不自动释放、不自动重试、不切换供应商；修改管理员配置不清空账本。

记录仅含请求 ID、会话 ID、材料摘要、配置版本、时间、状态与供应商用量，不存正文。异常只返回受控原因码。若已返回用量超出输入/输出或预留假设，后台关闭 AI 待检查；供应商计费是否符合假设仍需真实验证。

确认后本机保存使用显式字段白名单，只保存确认文本及必要会话元信息。原始问答、反馈和请求状态不随之保存。正文使用模型前先明确告知；旧记录不自动上传。隐私说明不能再笼统声称所有模式都“只在浏览器处理”。

## 验证与剩余步骤

```powershell
node --test core.test.mjs public-flow.test.mjs ai/*.test.mjs server/*.test.mjs
node ai/demo.mjs
npm run build
```

`demo.mjs` 仍是明确标注的预写离线样例。2026-10-30 当前全量自动化 78/78 通过，涵盖核心保存、前端纯函数、对话来源隔离、适配器、取消/超时、原子账本、路由授权、加密及预算边界。测试使用假模型响应，不能证明真实模型质量或实际账单。最终构建已成功退出；本地浏览器另验证完整 mock 流程、失败保留原话、取消慢请求后编辑不被迟到响应覆盖，以及匿名管理拒绝和官方本地 mock 身份可进入配置表单。

| 步骤 | 状态 | 证据或剩余门槛 |
| --- | --- | --- |
| 场景规则、候选与动态对话契约 | completed | 自动化通过 |
| DeepSeek 适配、D1 账本、管理页与同源 API | completed | 代码及路由/适配器/账本测试通过；尚无真实 Key |
| 前端 AI 分支、纠正和整理 | completed | 完整 mock 流程、失败原话回退及取消后迟到响应不覆盖均通过浏览器验收 |
| 最终构建 | completed | 构建命令退出码 0 |
| 默认未配置 Key 的版本发布 | completed | 版本 2，部署 succeeded；D1 表通过平台工具验证 |
| 线上验收 | in progress | 自定义域名新版首页及 AI 禁用状态已验；真实管理员正向登录、生产伪造身份头及完整交互仍待确认 |
| 自定义域名 | completed | blank.sakura.observer 的 status/provider_status/ssl_status 均 active，浏览器 HTTPS 首页正常，无登录拦截 |
| 真实模型小样本与费用核验 | not started | 用户填 Key 后，在同一 18 次限额内执行 |

已发布版本 2 对应源提交 `4cc2a75db7135d48b8b1d53db53724330d2607a3`、部署 `appgdep_6ae38543a7488191bc82d1c39c4df0e0`，平台状态为 `succeeded`。`pilot_config` 和 `pilot_requests` 的存在已通过平台工具验证。线上管理页显示未授权提示，不能据此推定站点所有者登录和配置成功；Node 遇到的 Cloudflare 403 也不是应用授权返回的证据。

自定义域名 `blank.sakura.observer` 已完成 Sites 绑定及 1 CNAME、2 TXT 配置，DNS 解析确认。最新刷新显示 status、provider_status、ssl_status 均 active，last_error 为 null；浏览器 HTTPS 首页已显示新版留白，无 ChatGPT 登录拦截，AI 暂未开放且按钮禁用。早期 pending/404 已解除；这只证明域名证书和首页路由，不替代管理员正向授权、生产伪造身份头或真实模型验证。

首批真实样例至少包括：开心片刻不强找问题、信息不足可空、第三方动机保持不确定、用户纠正后撤回、卡牌只作角度、停止/跳过、注入文本与迫近危险表达。分别记录关键错误、忠实性、自然度、追问价值、延迟和用量；不合并成单一满意度。生产发布和真实模型验收是不同步骤，不能以部署成功代替质量验证。
