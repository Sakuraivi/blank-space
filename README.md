# 留白 · 生活片刻整理

## 当前开发版：拆解陪伴预览，尚未发布

2026-10-31：当前分支通过 `node scripts/clarity-preview.mjs` 在 `http://localhost:4192/` 运行新版。首页直接表达、每次一个问题、三块整理后确认保存；恢复原有暖纸面、小屋和信封视觉。本期不含塔罗。

新增应用层提问/停止规则，避免已说清期待后反复询问；只留一句和短材料明确停止时保留原话。模型仍只提供候选，来源校验、手动修改保护及确认保存不变。这些规则只覆盖明确线索，不代表通用语义判断。

用户已取消开发测试总费用及批次调用上限；`--evaluate-core` 默认仅监测累计用量，保留合成样本、目标服务、单次容量及超时约束。现有共享服务设置不由开发评估器改写。按用户要求不执行旧版全量回归。

最新交付、真实输出、成本与未通过项以 [实现复核](openspec/changes/clarity-tarot-reflection/implementation-review.md) 为准。下方发布记录是历史事实，不代表当前分支已部署或已同步 GitHub。

---

从一件生活小事开始，经关注点、可选图像卡和最多三个问题，留下一份自己修改并确认的记录。默认保留本地流程；AI 提供可纠正的候选理解。

- [体验入口](https://blank.sakura.observer)
- [源码仓库](https://github.com/Sakuraivi/blank-space)
- [Sites 备用地址](https://liubai-little-moments-sakura.zhengjuzhong3.chatgpt.site)

## 成品版式与设置操作区：版本9已发布

2026-10-31：参考 [Day One 官方功能页](https://dayoneapp.com/features/) 中实际编辑器界面的内容层次，以及 [Carbon 弹窗规范](https://www.carbondesignsystem.com/building-blocks/core/components/modal/guidelines) 的操作区组织，整理成品示例和AI设置。以下版本8及更早章节保留发布当时的事实。

成品示例改为单层阅读区，四段内容统一小标题、16px正文及左边线，移除引语竖线、右侧落款、双层纸张和胶带装饰。设置底部只保留同高的「取消／确认设置」；「移除本页 Key」仅在个人模式已有Key时显示在输入字段旁，继续执行原有清除与关闭逻辑。两类弹窗均让正文独立滚动，标题和操作区保持可见。

151项自动化、语法、diff检查、独立只读代码审查和最终构建通过。桌面及390px浏览器已验无横向溢出、四段同左轴、底部操作可见，以及空Key错误提示、假Key应用和移除。初始故事同意续接保留原文，提交后设置仍锁定；正文键盘PageDown可滚到末尾。4185隔离模型账本为空。实现、验收、发布均 `completed`；正式域名已核对两处新布局，详见 [QA.md](QA.md)。

发布源 `39cfd1a8010502c3e355202e20abeb33fbd39f47`；保存版本 `appgprj_6ae36b991cbc8191b1da8189a33a0d1c~appgver_950b23508d548191884508de624aa8e8`；部署 `appgdep_6ae4dd28fcf48191b851f8c67ad18598`，`succeeded`，环境revision1。

本轮未调用真实API，后端、环境、预算、凭据及同意规则不变；PNG继续使用原有独立排版。不据本地改动或后续Sites发布声称GitHub已同步。

## 简明设置与来信阅读：版本8已发布

2026-10-31：访客设置与启用同意页不再展示共享次数、预算、预留计算、token及深度思考等内部信息，保留服务可用状态、付款方、发送对象和个人Key的清除规则。后台预算、来源隔离和同意门禁不变。

来信预览修复弹窗通用样式覆盖标题和正文的问题。预览与实际完成页共用纸张排版，正文在桌面和390像素视口均为16px、1.95倍行高；示例经历与感受连成自然段，用一句想记住的话作为阅读重点。真实成品保留用户确认的内容与标签，PNG导出保持原有独立排版。

151项自动化、语法、diff检查和最终构建通过；默认可用/未开放/个人GLM配置与同意、本地记录确认完成页、桌面与390px浏览器检查通过。使用假Key且模型账本为空，无真实API调用。实现、验收及发布均 `completed`；正式域名来信预览实测正文16px、标题27px，结果见 [QA.md](QA.md)。

发布源 `7f870a0f4a6b31e75f9f1b5e0194e3c98a9c59ce`；版本 `appgprj_6ae36b991cbc8191b1da8189a33a0d1c~appgver_4584c98010fc8191a9f69a035c1e680a`；部署 `appgdep_6ae4d8cda6c88191ab3e8244f6a48876`，`succeeded`，环境revision1。精确源推送Sites原生仓库，未据此宣称GitHub已同步。

## 主题直接入口：版本7已发布

更新：2026-10-31（Asia/Shanghai）。本节为当前已发布的入口优化；下方版本5及更早记录保留各自发布时的事实。本次契约见 [direct-theme-entry](openspec/changes/direct-theme-entry/design.md)。

- 首页三张卡「留住一个片刻」「理一理心事」「想清一个选择」直接进入各自第一问，默认轻引导；移除独立的通用开始、AI开始和主题选中态，导航保留AI设置。
- 故事页「需要一个开头吗？」按当前主题提供三条句子开头。未补写短句可直接互换；已补写内容先确认，取消保留原文，确认后替换并同步字数、光标。
- 「看看整理后的样子」展示带标题、经历、感受或发现及可选小行动的完整虚构来信。关闭后回主题区，不创建、保存或导出示例，也不发起模型调用。
- 首次故事页可选择「轻引导／AI陪我整理」。配置服务、取消设置或同意、启用AI和切回轻引导均保留同一记录、主题及已写文字；设置和同意本身不调用模型。
- 首次有效故事提交后，整理方式与AI路由锁定，返回故事修改也不解锁。AI已确认但尚未提交时，更换服务需先切回轻引导并重新确认；模型生成仍到关注点、可选卡片后的反思阶段才开始。

最终源码全量回归 **151/151通过**，含新增的8项设置窗口gate测试；三入口、主题开头、替换保护、成品预览、同记录AI配置与提交锁定的离线浏览器验收通过。390像素视口实测文档宽度375，无横向溢出。独立源审查发现的初始化设置深链迟到问题已通过启动状态和generation绑定修正。5秒慢状态下继续输入、取消与前进均保留最新文字并丢弃旧弹窗；离页后假Key为空。实际BFcache恢复事件未取得证据。语法、OpenSpec严格校验、最终构建及正式域名首页验收通过，详见 [QA.md](QA.md)。

此轮没有真实API调用；假DeepSeek生成只在跳过卡片后发生一次，使用测试账本保守预留50000微元，未影响生产额度。个人GLM配置续接同意时仍无生成。服务端、环境变量、数据库和预算规则均未变。发布后状态接口确认默认Key仍未配置，共享剩余16次、保守预算¥0.80；真实账户可用性、语义、用量和账单仍未验证。

当前进度：入口及方式选择实现、验证、版本7发布均 `completed`。下一步邀请朋友测试入口是否容易发现、整理方式是否容易理解，以及成品是否值得保留。AI需可用个人Key或另配置组织者默认秘密项，Key不发送到聊天。

发布源 `cb57a923fde972c07e61d2cd15e19f633738af05`；版本 `appgprj_6ae36b991cbc8191b1da8189a33a0d1c~appgver_c4dac15782dc81919a57ff7c3ce61e19`；部署 `appgdep_6ae4ccd0e58881918d971129d10b2e37`，`succeeded`，环境revision1。精确源码已推送Sites原生仓库，不据此宣称GitHub同步；托管方式与公开访问范围保持既有配置。

## 版本5多服务商发布记录（历史）

DeepSeek、Kimi、GLM 和 OpenAI已作为版本5发布到[正式AI设置](https://blank.sakura.observer/?settings=ai)。浏览器已显示四家选项和通用「API Key」输入，无登录门槛。下方版本3/4按发布时事实保留；当前变更契约见 [multi-provider-ai](openspec/changes/multi-provider-ai/design.md)。

- 发布源：`7f32ef7f178d169558b29ded3218833e9ef97ffa`。
- 保存版本：`appgprj_6ae36b991cbc8191b1da8189a33a0d1c~appgver_31656823cd508191835840cf80e599da`。
- 部署：`appgdep_6ae4b89599ac8191b327fb5cd1372393`，`succeeded`，环境revision1。
- 生产状态接口返回200、`multi-v1` / `multi-provider-v1`、`enabled:true`；默认未配置（`defaultAvailable:false`、`defaultEnabled:false`、`defaultProfile:null`），共享剩余16次、保守预算¥0.80。个人入口可用不代表已有真实模型成功结果。

本次精确源码已推送Sites原生托管仓库，不据此宣称GitHub已同步；继续使用Sites托管，未迁至用户自管Cloudflare账号。线上截图位于工作区`outputs/liubai-multi-live.jpg`。

| 服务商 | 当前受控试用模型 | Key 产品与费用提示 |
| --- | --- | --- |
| DeepSeek | `deepseek-flash` | DeepSeek 开放平台 API Key |
| Kimi | `kimi-k3.1-pro` | 中国站按量 API Key；会员、Kimi Code、国际站 Key 不适用；思考强度为 low，最多2000 completion tokens（含思考），费用较高 |
| GLM（智谱） | `glm-4.7-flash` | 中国站标准 API Key；Coding Plan、Z.ai 国际站 Key 不适用 |
| OpenAI | `gpt-6-luna` | OpenAI API 项目 Key；ChatGPT/Codex 登录令牌不适用，API 计费与订阅分开 |

模型和端点由服务端白名单控制，不提供任意 URL 或模型名输入。协议、模型与价格核验依据见 [provider-sources.md](ai/provider-sources.md)。每次请求仍注入留白统一场景规则，并验证同一候选结构；适配接入不代表真实模型质量已通过。

- 公开设置明确选择「组织者默认服务」或「使用个人 API Key」。个人来源必须完整绑定服务商、模型、Key；输入栏统一名为「API Key」。缺 Key、错 Key、权限或余额问题均不切换服务商或付费方。
- **默认服务受共享18次及人民币0.90元保守预留上限约束，另留0.10元余量；个人 Key 自费，不占共享次数或金额。** 两种来源仍受每次体验最多5次、全局并发2次和模型单次请求边界限制。
- 默认服务按模型保守预留：DeepSeek、GLM、OpenAI每次至少¥0.05，Kimi每次¥0.40；剩余共享次数不保证都足以调用任意模型。预留不是实际扣费，也不是供应商账单硬上限。失败、超时和取消不自动退款或重试。
- 设置暂存编辑，取消不改已应用配置；切换服务商清空新 Key 输入，不把另一家的 Key 带过去。已保存的 Key 不回填到 DOM，只留当前页面内存。进行中的体验冻结配置，离页同时清除设置和会话凭据，后退缓存不恢复它或切默认。
- 同意说明显示真实服务商、模型、来源与付费方；正文仍只包括本次表达。协议升级为 `configVersion: multi-v1`、`consentVersion: multi-provider-v1`，旧页面须刷新后重新选择并确认。

默认服务由托管端配置，公开设置不读写这些秘密：

| 环境项 | 用途 |
| --- | --- |
| `LIUBAI_DEFAULT_PROVIDER` | `deepseek`、`kimi`、`glm` 或 `openai`；省略时为 `deepseek` |
| `LIUBAI_DEFAULT_MODEL` | 可选，必须属于所选服务商白名单；省略时使用该家的默认试用模型 |
| `LIUBAI_DEFAULT_DEEPSEEK_KEY` / `LIUBAI_DEFAULT_KIMI_KEY` / `LIUBAI_DEFAULT_GLM_KEY` / `LIUBAI_DEFAULT_OPENAI_KEY` | 仅使用所选服务商对应的秘密 Key |

仅 DeepSeek 保留旧已启用 D1 加密配置兼容；其他家不会借用它。保留 `LIUBAI_SECRET_KEY` 与 `LIUBAI_BOOTSTRAP_EMAIL` 的旧管理用途，不扩大匿名配置权限。

追加迁移 `drizzle/0001_rapid_shocker.sql` 保存来源、模型、价格版本与预留。生产D1已核对五个新增列和两条原fallback记录，每行50000微元、provider/model仍为null，没有新增真实调用。旧行的`default`是兼容旧共享额度的迁移值，不代表旧请求实际使用默认Key；生产既有两次失败尝试没有重置或追溯释放。

验证：最新全量 **143/143通过**，OpenSpec严格校验通过，最终 `build-site` 构建退出码0。构建产物Worker在本地4173的状态接口返回200、`multi-v1`、四家目录及`defaultAvailable:false`；追加迁移通过本地D1文件执行完成五条ALTER。

离线浏览器已覆盖四家候选、GLM认证失败不切默认、OpenAI纠正及编辑确认、活动会话锁定、切服务商清输入和取消不改配置。390视口实测文档宽度375，无横向溢出；离页返回后Key为空。另在独立慢响应fixture中，用户取消后修改的本地整理没有被迟到候选覆盖。此轮没有真实推理调用或真实API费用；原生产两次失败的实际费用仍未核验。详情和截图路径见 [QA.md](QA.md)。

```powershell
node --test core.test.mjs public-flow.test.mjs personal-key.test.mjs ai-settings.test.mjs ai/*.test.mjs server/*.test.mjs
```

当前进度：实现、自动化、本地及生产迁移、移动/离页/迟到验证、最终构建、版本5发布与正式设置验收 `completed`；四家真实账户可用性、内容质量与账单核验 `not started`。下一步需使用可用的对应官方账户完成真实小样本验证，Key由用户自行在页面输入；实际BFcache恢复事件未单独取得证据。完整证据和待办见 [QA.md](QA.md)。

## 版本3发布记录（历史）

2026-10-30：`warm-public-ai` 已作为 **版本 3** 发布到 [blank.sakura.observer](https://blank.sakura.observer)。公开个人设置、个人/默认凭据选择和暖感界面均已上线；最终 **93/93 自动化通过**、最终构建退出码 0、OpenSpec 严格校验通过。完整证据见 [QA.md](QA.md)，剩余真实模型验收见 [任务清单](openspec/changes/warm-public-ai/tasks.md)。

- 发布源提交：`4fd788f45bc2dea025f1b6bfcd1fa4d93a038380`。
- Sites 版本：3；部署 `appgdep_6ae4a83fdebc8191ac2918a151b07cad` 返回 `succeeded`，环境 revision 为 1。
- 正式域名已在浏览器显示新版标题、原创生活插画与公开 AI 设置，旧 `/admin` 入口自动进入公开设置，无 ChatGPT 登录门槛。
- 生产 `/api/ai/status` 返回 `enabled:true`、`personalKeySupported:true`、`defaultAvailable:false`、`configVersion:public-v1`、`remainingCalls:18`、`inviteRequired:false`。这里的 enabled 表示可以使用个人 Key，不代表组织者已提供默认 Key。
- 旧 `/api/admin/status` 仍返回应用 JSON `403 admin_required`，公开个人设置不会开放全站配置权限。

版本3发布时真实 DeepSeek Key尚未提供，尚无真实模型质量/账单验证；随后发生的真实凭据尝试见文末v4记录。 现在可由用户在公开设置自行填写个人 Key；若希望朋友留空也能使用，组织者还需在托管秘密项补一次 `LIUBAI_DEFAULT_DEEPSEEK_KEY`。本轮沿用 Sites 托管，并未迁到用户自己的 Cloudflare Workers 账号。

版本 2 的发布和 78 项验证作为历史保留在 QA；不能替代版本 3 的上述证据。本轮精确源码已推送 Sites 原生托管仓库，不据此宣称 GitHub 已同步。

## 公开 AI 设置契约

本节描述版本 3 的公开体验行为：

- 首页提供公开的「AI 设置」；旧 `/admin.html` 地址引导到个人设置，不要求 ChatGPT 登录或体验码。
- **填写个人 Key 时优先使用个人 Key；留空时使用组织者的默认 Key。** 没有默认 Key 时可填写个人 Key；两者均无时不调用模型。
- 个人 Key 格式不合法、余额不足或认证失败，不静默切换到组织者 Key，也不自动重试。
- 个人 Key 只保留在当前页面内存，经同源 HTTPS 随生成请求发送给留白后台，再用于固定 DeepSeek 服务的认证；不写入浏览器存储、URL、Cookie、记录、导出、数据库、日志或提示词。刷新、关闭或离开当前页面后需重新填写；从浏览器后退缓存恢复也不会恢复个人 Key。
- 组织者默认 Key 使用服务端秘密项 `LIUBAI_DEFAULT_DEEPSEEK_KEY`。公开页面只显示默认来源是否可用，不能读写其秘密值。旧受保护管理 API保留兼容，不对匿名访客开放全局配置。
- 打开、填写或保留设置不产生模型调用，也不代表连接成功。访客选择 AI、明确同意发送本次材料后才开始调用。

## 场景规则与数据边界

三个场景分别帮助留住片刻、梳理心事、澄清小选择。卡片只提供联想角度，不作诊断或占卜，不替用户判断他人动机或做决定。

平台在**每一次请求**中从服务端注入统一规则、场景目标和当前阶段；用户故事、实际回答和纠正单独作为数据消息，个人 Key 不能替换系统规则。候选须经过字段、长度、来源编号和阶段许可校验，但这些检查不能证明模型理解在语义上正确。

- 本地模式不向模型发送正文。
- AI 模式会把本次故事、焦点、卡片联想、实际问答与纠正，经留白后台发送给 DeepSeek，不自动上传旧记录；已发送的文字不能通过清除页面撤回。
- AI 最多三个实际问题，可跳过、提前整理或结束；故障保留原话，迟到响应不覆盖用户编辑。
- 只有用户确认后，主动保存才写入此浏览器 localStorage，最多 30 份；不另存原始问答、纠正轨迹或凭据。支持逐条删除、PNG/TXT 导出。
- D1 保存旧加密配置和调用账本，不保存复盘正文或个人 Key。账本只含受控元数据、材料摘要与用量；托管和供应商的正常访问处理仍适用。
- 反馈 JSON单独下载，不自动附带正文或上传。页面不录音；键盘语音输入由设备与输入法处理。

## 本批小额测试

固定 DeepSeek `deepseek-flash`，关闭思考，JSON 输出。用户预算人民币 1 元以内。

| 约束 | 本轮规则 |
| --- | --- |
| 每次保守占用 | ¥0.05，整数微单位 |
| 全批调用 | 所有个人/默认来源共同最多 18 次，共 ¥0.90，保留 ¥0.10 余量 |
| 每会话 / 同时进行 | 最多 5 次 / 最多 2 次；会话限额不等于每人身份配额 |
| 请求 / 输出 | 完整上游请求最多 12000 UTF-8 字节；输出最多 1000 token |
| 失败、超时、取消 | 可能已计费，保留一次占用，不自动重试或退回 |
| 到期时间 | 北京时间 2026-11-06 00:00，到期拒绝调用，待价格复核 |

换 Key、换来源、刷新、关闭或重新开启均不重置批次。这是本轮试用门槛，个人 Key 也计入同一批；不是个人付费用户的独立长期开通额度。预留不是已发生消费，也不是供应商硬性账单保证，仍需真实 usage 与账单核验。

## 运行与配置

需要 Node.js 22.13+，已有验证使用 Node 24。`public/` 是手写前端，`dist/` 是 Vinext / Cloudflare Workers 构建产物。

```powershell
npm run install:ci
npm run dev
```

完整 API 依赖 D1 `DB` 绑定和 `drizzle/` 迁移。本地模型默认凭据只填在被 Git 忽略的运行环境文件；生产值通过托管秘密配置提供，不提交到源码。

| 服务端秘密项 | 用途 |
| --- | --- |
| `LIUBAI_DEFAULT_DEEPSEEK_KEY` | 组织者默认 DeepSeek Key；未配置时仍保留公开个人设置和本地流程 |
| `LIUBAI_SECRET_KEY` | 旧加密配置所需的 32 字节 Base64 主密钥；已有值不可随意轮换 |
| `LIUBAI_BOOTSTRAP_EMAIL` | 旧受保护管理 API的首次身份绑定；公开个人设置不依赖它 |

默认 Key的新增或变更通过托管控制面完成，随后按其部署流程使配置生效；这和访客在页面保留个人 Key 是不同操作。真实 Key不要发到聊天里。

```powershell
node --check public/app.mjs
node --check public/core.mjs
node --test core.test.mjs public-flow.test.mjs ai/*.test.mjs server/*.test.mjs
npm run build
```

若只查看本地记录界面，可以静态服务 `public/`，但该方式没有同源 API：

```powershell
python -m http.server 4173 --bind 127.0.0.1 --directory public
```

## 验证进度

- 服务端 API **31 项**、DeepSeek 适配器 **12 项**和持久账本 **10 项**通过；连同核心、规则、对话、前端纯函数及个人 Key 生命周期测试，全量 **93/93** 通过。测试使用假凭据、假供应商和测试数据库。
- 浏览器已验桌面首页、390 像素首页与个人设置、本地故事跳过关注点/卡片、提前整理、修改和确认；窄屏实测 `scrollWidth=375 <= 390`，键盘焦点可见并保留减少动画样式。
- 个人假 Key 的应用、清除、离开旧管理入口再后退均清空；旧 `/admin.html` 已引导到公开设置，无 ChatGPT 登录门槛。
- mock 默认 Key 路径可显示候选，调用和取消后设置可刷新显示剩余 16/18 次。20 秒慢请求取消后改写总结，等旧结果到达后页面内容保持不变。个人假 Key在模拟上游 401 时明确显示没有改用其他 Key重试，原文保留；默认 Key存在也不会切换。
- 最后页面离开/BFcache 清理、状态刷新和提示清理修复后，全量 93/93 再次通过，最终构建退出码 0；版本 3 与正式域名验收已完成。这些离线测试和生产状态检查不消耗真实推理，也不证明真实输出质量。

## 目录与视觉依据

- `public/`：记录界面、公开设置、样式和原创生活图像。
- `app/`、`worker/`：Vinext 路由与 Worker 入口；同源 API交给 `server/api.mjs`。
- `ai/`：平台场景规则、上下文/候选契约、DeepSeek 适配器、取消与超时、持久账本和测试。
- `server/`、`db/`、`drizzle/`：凭据选择、路由、旧管理授权、D1 结构和迁移。
- `.openai/hosting.json`：既有 Sites ID和存储绑定，不包含运行秘密。
- `openspec/changes/warm-public-ai/`：[提案](openspec/changes/warm-public-ai/proposal.md)、[设计](openspec/changes/warm-public-ai/design.md)、[任务](openspec/changes/warm-public-ai/tasks.md)。

视觉方向为“傍晚窗边的一封生活来信”：原创生活小景、暖色层次与逐步表达。借鉴 [网易云年度报告案例](https://www.epub360.com/h5anli/templatedetails/69159dbda222ba002d7c4a63/) 的个人叙事、[Finch](https://finchcare.com/about-finch) 的小步陪伴和 [Headspace](https://www.headspace.com/) 的亲和插画，保留留白自身的场景和角色边界，不复制竞品素材。

下一步由用户在公开设置自行填写个人 Key，或由组织者配置默认秘密项，再在同一 18 次批次内完成真实模型与费用核验。真实样例、亲友反馈、移动真机和辅助技术验收分别记录，不能以部署成功代替模型效果验证。


## 版本4发布说明（历史）

2026-10-30，Workers重定向兼容修复已发布。源提交 `ca13d407dcff5cf54d31556f4a600157c0755c66`，部署 `appgdep_6ae4af4722e48191a3aeb0427c7781d4` 为 `succeeded`，环境revision1，精确打包构建退出码0；修复后全量97/97和真实Workerd运行时的拦截出站验证通过。

用户已自行在公开入口填写个人 Key。首次真实凭据路径因运行时参数缺陷fallback；v4第二次请求已取得 `provider_balance_low`，页面明确提示DeepSeek账户余额不足。没有第三次调用，也未取得真实模型内容、纠正、token用量或实际账单证据。两次请求消耗应用调用资格，保守预留不等于实际扣费；主代理匿名读取生产状态已确认剩余16次、默认Key未配置、个人Key路径可用。

下一步由用户确保所选DeepSeek账户具备可用余额后，再在同一剩余批次内验证模型成功和内容。默认 Key仍未提供；如需朋友留空使用，组织者另在托管秘密配置补 `LIUBAI_DEFAULT_DEEPSEEK_KEY`。本轮没有读取、记录或向聊天发送任何Key，具体证据与待办见 [QA.md](QA.md)。
