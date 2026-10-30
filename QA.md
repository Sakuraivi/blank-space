# 验证记录

日期：2026-10-30（Asia/Shanghai）。全部浏览器内容为本次创建的虚构测试数据。

以下最初三节及公开访问检查属于此前固定问题 v0.1 原型的历史验收，不能作为当前 AI 版本已经发布或模型能力已验证的证据。当前 AI 改动的状态见文末。

## 历史 v0.1：自动化与审阅

- Node 语法检查：app.mjs 通过。
- node:test：4 项通过，0 失败。覆盖三模式/六卡接口、空答案与特殊字符原话、保存输入形状与长度边界、旧记录编辑时的离开提醒规则。
- 六张 SVG 均 XML 解析成功，无脚本与外部引用。
- 独立源代码审阅发现并修复：跳过问题仍保留当前文字、旧记录原 story 为空导致编辑刷新提醒失效。

## 历史 v0.1：真实浏览器验收

- 开心片刻：从入口到确认，包含焦点、翻卡/换卡、联想、三个问题、前后返回修改。
- 心事：跳过焦点与卡牌；填写后跳过问题，确认清除；提前整理仅保留实际回答。
- 小选择：专属问题显示正确，允许提前整理而不替用户选择。
- 空故事提交被拦截。包含 script 标签的虚构文字按普通文字显示。
- 题目往返时独特答案分别保留，新题保持空白，未发生答案串位。
- 复盘删除、改写和不确定标记反映到确认结果；重新打开保存的记录仍使用确认后的内容。
- 保存后退出仍能找到记录；删除后记录列表为空。测试记录已经从应用存储删除。
- PNG 文件实际下载并视觉检查，中文、换行、标签和内容完整。
- TXT 与反馈 JSON 实际下载并检查：TXT 不含被删除的原故事；反馈没有自动包含复盘正文。
- 390px 宽 iframe 手机视口的首页和表单截图检查：主要内容与操作按钮可用，没有观察到横向裁切。此项是浏览器窄视口检查，不等同于真机验收。

## 历史 v0.1：当时未验证

- iOS Safari/Android 真机、输入法语音和辅助技术的完整验收。
- 不同浏览器的 beforeunload 提示策略；修复规则有单元回归覆盖。
- 真人实际耗时、卡牌增益、复盘清晰度变化及再次使用意愿。
- 生成模型能力：当时固定问题版本无运行时模型，不能据此评估智能追问效果。

## 历史 v0.1：公开访问与源码发布检查

日期：2026-10-30（Asia/Shanghai）。

- 应用源码检查：没有 ChatGPT 登录流程、OAuth、运行时 API 请求或 API Key 依赖。
- Sites 访问配置已从 `custom` 改为 `public`；平台返回的访问策略 revision 为 2。
- 不带 Cookie 或 Authorization 的 HTTP 请求：主页与 9 个应用资源均返回 200，无登录重定向。
- 远端 JS、CSS、SVG 与本地源码内容一致；HTML 的应用内容一致，平台额外注入 Cloudflare 防护脚本。
- `.mjs` 返回 `text/javascript`，可作为 ES Module 加载。
- 重新执行 app.mjs/core.mjs 语法检查及 4 项核心测试，全部通过；业务代码无变更。
- 本轮验证针对匿名 HTTP 访问与资源完整性，未重复真机浏览器验收。

上述访问检查只证明当时固定问题版本的匿名访问与资源完整性。

## 当前 AI API 试用版本：阶段验收

更新：2026-10-30（Asia/Shanghai）。本轮已选择 DeepSeek `deepseek-flash`，预算人民币 1 元以内；实际 Key 尚未填写，没有真实模型调用或账单验证。

- 全量命令 `node --test --test-reporter=dot core.test.mjs public-flow.test.mjs ai/*.test.mjs server/*.test.mjs` 已成功退出，**78/78 通过**。
- 覆盖原有记录保存、前端数据白名单和动态问答、问题/假设与用户证据隔离、纠正上限、候选阶段约束、异步取消和迟到结果、DeepSeek 响应解析、D1 原子预留与幂等、管理员授权、凭据加密、同源和预算门禁。
- 自动化使用假凭据、假供应商响应和测试数据库，不消耗真实 API 额度；SQLite 测试验证 SQL 行为，不能替代生产 D1 部署检查。
- 前端模块语法检查及 whitespace 检查通过。独立审查完成；已对齐前后端体验码/纠正长度及错误码，并修复 AI 回退到本地时可能重新增加三题的问题。
- 完整 mock 浏览器流程已经跑通：主动选择 AI、传输同意、体验码、实际问题、理解反馈与纠正、整理和确认。这是模拟供应商响应的界面验收，不证明真实 DeepSeek 输出效果。
- 浏览器失败回退验证通过：按原话整理后保留故事。
- 浏览器取消与迟到响应验证通过：模拟 20 秒慢响应，取消后改写总结，等待原响应到达并读取页面状态，确认没有覆盖用户编辑。
- 管理界面验证：匿名访问被拒绝；使用官方本地 mock 登录后配置表单可用。这不替代生产管理员身份验证。
- 最终待发布源码构建通过，退出码 0。

### 尚待本轮完成

- 版本 2 已部署，生产自定义域名首页及 AI 禁用状态已验；仍需完成站点所有者正向登录、生产伪造身份头测试和完整线上交互/API 验收。
- 用户在管理员页填写真实 Key 后，用少量虚构样例验证连接、JSON 候选、纠正效果、延迟和用量，全部计入同一批最多 18 次调用。
- 对照真实供应商 usage 与账单检查每次 ¥0.05 保守预留假设。当前规则最多占用 ¥0.90，余留 ¥0.10；这不是已发生消费或供应商硬性账单保证。
- 真实模型场景评测、亲友体验、移动真机和辅助技术完整验收。

本次版本 2 已部署，但不能沿用历史 v0.1 的访问检查或平台部署成功状态，宣称真实模型及全部生产链路已验证。

## 版本 2：生产发布与域名检查

日期：2026-10-30（Asia/Shanghai）。

- Sites 版本：2。
- 应用源提交：`4cc2a75db7135d48b8b1d53db53724330d2607a3`。
- 部署 ID：`appgdep_6ae38543a7488191bc82d1c39c4df0e0`，平台返回 `succeeded`。
- 通过平台数据库工具确认 `pilot_config`、`pilot_requests` 存在；此证据说明表已落地，不等于真实模型请求已成功。
- 浏览器访问线上管理员页面，显示未授权提示；尚未验证站点所有者正向登录、首次绑定及 Key 配置操作。
- Node 公网 HTTP 遇到 Cloudflare 403。这是边缘访问限制，**不作为应用返回 403 或管理员授权正确的证明**。
- 真实 DeepSeek Key 仍未填写，没有真实模型调用、质量测试或供应商账单证据。

### 自定义域名

- 用户选择 `blank.sakura.observer`；已完成 Sites 绑定。
- 已创建 1 条 CNAME 和 2 条 TXT，DNS 解析已确认。
- 首次检查曾为 `pending` / `pending_validation`，浏览器曾返回 404；这是等待验证时的历史结果。
- 最新 Sites refresh 的 `status`、`provider_status`、`ssl_status` 均为 `active`，`last_error` 为 null。
- 浏览器刷新 `https://blank.sakura.observer` 已显示新版留白首页，无 ChatGPT 登录拦截；AI 显示暂未开放且按钮禁用，符合真实 Key 未配置状态。
- 浏览器访问同域 `/api/ai/status` 返回 JSON：`enabled:false`、`reason:not_configured`、`remainingCalls:18`、`model:deepseek-flash`，确认生产状态 API 和持久账本读取正常。
- 当前域名、证书和首页 HTTPS 路由已验，可作为本地记录体验入口；仍需单独验证真实管理员正向登录、生产伪造身份头与完整同源 API/交互链路。

### 管理员登录说明

管理员目前使用 ChatGPT 登录，是复用 Sites 的身份源来保护 Key 与额度，不是 DeepSeek 的要求。普通体验者使用本地模式或体验码，无需该登录。邮箱 OTP 等独立认证仅作为后续建议，尚未收到实施请求，也没有做认证改造。


## 版本 3：公开个人设置与暖感改版

更新：2026-10-30（Asia/Shanghai）。用户要求的个人 Key 优先、留空使用组织者默认 Key已实现并发布；公开页面无需登录或体验码。服务端秘密项为 `LIUBAI_DEFAULT_DEEPSEEK_KEY`，默认秘密不通过公开页面读写。个人 Key只在当前页面与单次后台请求内存中使用，所有来源共同计入本轮 18 次/每会话 5 次/并发 2 次限制。版本 3发布时真实 Key尚未提供。随后用户已自行在生产入口填写个人 Key并进行首次真实凭据路径冒烟，结果失败；详见后续记录。实际供应商计费尚未核验。

### 自动化、构建与本地浏览器证据

- 最终全量 `node --test core.test.mjs public-flow.test.mjs ai/*.test.mjs server/*.test.mjs personal-key.test.mjs` **93/93 通过，退出码 0**；API 31 项、适配器 12 项、持久账本 10 项共 53 项，其余覆盖核心、规则、动态对话、前端纯函数和个人 Key生命周期。
- 自动化使用假凭据、假供应商和测试数据库，不访问真实推理。覆盖个人优先、默认来源、无默认、无效个人 Key不切默认、换来源不重置额度、异常用量停止和旧全局接口授权隔离。
- 页面通知清理、`pagehide`/BFcache 清理个人 Key及会话副本、拒绝过期个人凭据、剩余次数刷新修复后，**最终 `npm run build` 退出码 0**，OpenSpec 严格校验通过。
- 桌面和 390 像素首页/设置已截图审查。窄屏读取 `scrollWidth=375 <= 390`，无页面横向溢出；设置表单和输入清晰完整，键盘焦点可见并保留减少动画样式。
- 本地流程已验：故事、跳过关注点/卡片、提前整理、修改草稿、确认；三模式、卡片和保存导出继续由回归覆盖。
- 个人假 Key应用、清除、离开旧管理入口再后退均已验清空；`/admin.html` 和正式域名旧 `/admin` 都可进入公开设置，无 ChatGPT门槛。
- mock 默认 Key路径显示候选；调用与取消后设置显示剩余 16/18。此数字是离线 fixture 余量，不是生产批次用量。
- mock 20秒慢响应取消后改写总结，等待旧结果到达后页面状态无变化，迟到结果没有覆盖编辑。
- 个人假 Key经过实际服务端处理路径与模拟供应商401，前端明确显示“没有改用其他 Key重试”，保留原文；默认存在也不切换。此为模拟上游验收，不是真实 DeepSeek调用。

### 发布与生产核验

- Sites 保存版本：3。
- 发布源提交：`4fd788f45bc2dea025f1b6bfcd1fa4d93a038380`。
- 保存版本 ID：`appgprj_6ae36b991cbc8191b1da8189a33a0d1c~appgver_2b1125d2d4548191963fc151c217fab5`。
- 部署 ID：`appgdep_6ae4a83fdebc8191ac2918a151b07cad`，状态 `succeeded`，环境 revision为1。
- 浏览器访问 `https://blank.sakura.observer` 已显示新版标题、原创 SVG与公开 AI设置；旧 `/admin` 导航后自动进入公开设置并显示表单，无 ChatGPT登录门槛。
- 匿名 HTTP经系统既有代理读取 `/api/ai/status` 返回 **200 JSON**：`enabled:true`、`defaultAvailable:false`、`personalKeySupported:true`、`configVersion:public-v1`、`remainingCalls:18`、`inviteRequired:false`。enabled表示本批可以提供个人 Key体验，不代表已有默认 Key或真实连接已验证。
- 旧 `/api/admin/status` 返回 **403 JSON `admin_required`**。此为真实应用授权结果，区别于版本2时 Node公网 Cloudflare边缘403，公开设置没有把全局配置匿名化。
- 本轮精确源码已推送 Sites原生托管仓库；没有用这一结果推定远端 GitHub仓库已更新。D1账本没有为发布重置。

### 剩余验收

- `completed`：公开个人设置与服务端选择规则、暖感桌面/小屏界面、本地及 mock流程、最终自动化和构建、版本3发布和公开状态核验。
- `in progress`：用户已自行填写个人 Key；首次生产冒烟 fallback，正在修复运行时参数兼容缺陷。真实供应商成功、忠实性、纠正、延迟、usage和实际账单核验仍未完成；所有尝试计入同一批18次。
- `not started`：真实亲友反馈、iOS/Android真机与辅助技术完整验收。

本轮产物在 `openspec/changes/warm-public-ai/`。视觉为原创“傍晚窗边的一封生活来信”，借鉴网易云年度报告的个人叙事、Finch小步陪伴和Headspace亲和图像。版本3已上线，默认 Key尚未提供；真实凭据路径已开始验证但首次失败。发布成功和离线93项通过不能代替真实连接、语义或账单验证。


## 首次生产真实凭据路径冒烟：失败

时间：2026-10-30（Asia/Shanghai）。用户自行在公开设置填写个人 Key，主代理仅通过页面操作发起明确虚构的“周末和朋友散步”开心片刻；本记录不包含、读取或复制任何 Key。

| 证据项 | 本次结果 |
| --- | --- |
| 请求 ID | `e16f2585-d17f-43eb-b121-07e1ce18c5ed` |
| 凭据来源与场景 | 个人 Key，虚构开心片刻 |
| 网站请求 | Worker POST HTTP 200，约 164ms；HTTP状态不等于业务成功 |
| 业务结果 | `fallback`，未取得可用候选 |
| 账本开始 | `1793371415297`，北京时间 `2026-10-30 22:43:35.297` |
| 账本完成 | `1793371415322`，北京时间 `2026-10-30 22:43:35.322` |
| 账本耗时 | 25ms，仅为该开始/完成区间，不等于全链路延迟 |
| 供应商 usage | 全部为 null，真实 token用量未知 |
| 生产批次余量 | 18 → 17；一次资格已保守占用，不重置或退款 |
| 实际费用 | 未核验；不能把每次 ¥0.05保守预留当作真实扣费 |

已定位兼容缺陷：适配器使用 `redirect: 'error'`，而 [Cloudflare Workers 官方 Request文档](https://developers.cloudflare.com/workers/runtime-apis/request/) 明确该模式不受支持，会在 Request构造时抛出 TypeError；官方建议使用 manual并检查返回状态。该缺陷与本次极短的 fallback/空 usage相符，已形成修复依据；没有供应商账单证据时仍不将实际费用写成0。

已完成源码修复及本地验证：改为 `redirect: 'manual'` 并显式拒绝3xx，保留固定端点认证边界；新增不含原文、Key或认证头的受控元数据诊断日志。修复后测试见下节；最终构建将随打包执行，修复版部署与真实供应商成功仍未验证，原版本/部署 ID和既有计数保留为版本3历史事实。

本次能证明生产流程已接收一次真实凭据路径尝试并正确保守占用资格；不能证明 DeepSeek连接成功、语义质量、纠正有效或实际费用。`warm-public-ai/tasks.md` 中3.3已拆分为连接、内容、纠正、usage、账单五项，全部继续待办。


## 首次失败后的兼容修复：本地验证记录

更新：2026-10-30（Asia/Shanghai）。下列是首次失败后产生的新证据，不改写版本3发布时93/93与生产失败的历史记录。

- 聚焦回归：DeepSeek适配器 **14/14**、服务端API **31/31**、持久账本 **10/10**，合计 **55/55通过**。
- 主代理执行最新全量回归 **97/97通过，退出码0**，包含新增诊断日志2项；OpenSpec严格校验通过。
- **真实Workerd运行时、拦截出站**：测试用 `outboundService` 接管供应商请求，不访问真实DeepSeek，也不消费真实模型额度。
- 运行时复现：`redirect: error` 在Request构造阶段抛TypeError，出站次数为0；修复使用manual后模拟成功路径通过；模拟302只请求一次固定官方端点且不跟随，认证信息未被转发到重定向目标。
- 受控诊断日志在最终safety/config守卫之后记录实际返回原因；模块仅包含 `event/requestId(UUID)/stage/status/reason`，不含耗时和usage，后两者使用Worker trace/持久账本核验。白名单测试通过，不记录用户原文、Key、认证头或原始异常，不将HTTP200 fallback误记为上游成功。
- 此轮本地验证之后，修复版精确打包构建与v4部署已完成，见下节。生产已消耗的一次资格没有因修复退回或重置。真实模型成功、内容、纠正、usage和实际账单仍分别待验。

任务3.4、3.5、3.6a及3.6b已完成；v4公开状态已确认，3.3a–3.3e继续未勾。


## 版本4：兼容修复已部署，第二次真实凭据路径返回余额不足

时间：2026-10-30（Asia/Shanghai）。精确打包 `npm run build` 退出码0，版本4发布成功；本节补充新证据，不覆写版本3历史。

| 发布证据 | 值 |
| --- | --- |
| 发布源 | `ca13d407dcff5cf54d31556f4a600157c0755c66` |
| 保存版本 | `appgprj_6ae36b991cbc8191b1da8189a33a0d1c~appgver_03ef5035985081919e2b302f62ada4a7` |
| 部署 | `appgdep_6ae4af4722e48191a3aeb0427c7781d4`，`succeeded` |
| 环境revision | 1 |

第二次尝试保留用户当前页面的个人 Key内存，用明确虚构的生活样例发起；记录不包含任何Key，未进行第三次调用。

| 调用证据 | 本次结果 |
| --- | --- |
| 请求ID | `0dd54f5a-5987-46f6-a417-d48a7d3b3f09` |
| Worker请求 | HTTP200，约615ms；HTTP成功不代表推理成功 |
| 业务结果 | `fallback`，`provider_balance_low` |
| 前端提示 | “这次使用的DeepSeek账户余额不足” |
| 账本开始 | `1793372028955`，北京时间 `2026-10-30 22:53:48.955` |
| 账本完成 | `1793372029427`，北京时间 `2026-10-30 22:53:49.427` |
| 账本区间 | 472ms，不等于全链路耗时 |
| 供应商usage | 全部为null，真实token用量未知 |
| 生产批次余量 | 两次资格已消耗；主代理匿名读取生产status确认remainingCalls为16 |
| 实际费用 | 未核验；两次¥0.05保守预留不代表实际扣费¥0.10 |

取得供应商受控余额不足响应，说明修复后的请求路径已能返回这一上游错误；**尚未取得模型推理成功、真实内容或纠正效果证据**。供应商账户余额条件待用户处理后才继续3.3a；没有自动改用默认 Key或发起第三次重试。默认 Key仍未提供，真实usage与实际账单保持未知。


v4收尾状态：主代理匿名读取生产 `/api/ai/status`，确认 `remainingCalls:16`、`defaultAvailable:false`、`enabled:true`。错误界面截图已保存为工作区 `outputs/liubai-ai-smoke.jpg`，不含Key字段。没有第三次调用；生成语义、纠正、真实usage及实际费用仍未验证。

## 多服务商：版本5已发布

更新：2026-10-30（Asia/Shanghai）。多服务商实现已作为版本5发布，本节记录其代码、离线和生产验收，保留前述v3/v4历史事实；既有生产两次失败记录不重置。本次没有新增真实模型调用。

### 实现与自动化

- 四家官方目录和模型：DeepSeek `deepseek-flash`、Kimi `kimi-k3.1-pro`、GLM `glm-4.7-flash`、OpenAI `gpt-6-luna`。固定端点、模型参数与费用依据见 `ai/providers.mjs`、`ai/provider-sources.md`。
- 个人来源自费，不占共享次数/金额；默认来源保留18次及¥0.90保守预留上限、另留¥0.10。两者仍受会话5次、并发2次、单次请求边界与异常用量停用约束。
- 新协议为`multi-v1` / `multi-provider-v1`；缺个人Key、未知模型、默认路由变化或错路由候选均不静默换Key或服务商。场景规则每轮仍由服务端注入，同一候选验证适用于四家。
- 追加迁移`drizzle/0001_rapid_shocker.sql`已通过旧账本迁移测试：两条旧行的兼容迁移值为default，每行50000微元预留，不释放历史资格或费用预留；此字段不证明旧请求实际使用默认Key。
- 最新全量 `node --test core.test.mjs public-flow.test.mjs personal-key.test.mjs ai-settings.test.mjs ai/*.test.mjs server/*.test.mjs` **143/143通过**，此后代码未改变。OpenSpec严格校验通过，最终 `build-site` 构建退出码0。
- 本地D1最初尝试`migrations apply`因starter未配置迁移目录失败；随后按starter方式用Wrangler的文件执行命令运行`drizzle/0001_rapid_shocker.sql`，五条ALTER成功。没有修改旧迁移或历史账本；此为本地证据，不能替代生产迁移验收。
- 构建产物Worker在本地4173的`/api/ai/status`返回200 JSON、`configVersion:multi-v1`、四家目录、`defaultAvailable:false`。
- 测试使用假凭据、假供应商和测试数据库；此轮没有真实模型请求或新增真实API费用。生产既有失败的真实费用仍未知。

### 本地浏览器离线证据

主代理提供的fixture安全元数据位于工作区 `work/liubai/multi-browser-evidence.json`，不包含Key、原文或模型正文。

| 场景 | 已见结果 |
| --- | --- |
| 四家候选 | DeepSeek默认来源、Kimi/GLM/OpenAI个人来源均到模拟候选 |
| GLM个人认证失败 | 默认配置存在时模拟401，显示当前服务商错误、保留原话，没有换默认Key |
| OpenAI纠正与整理 | 纠正理解后进入可编辑整理，用户可修改并确认 |
| 活动会话设置 | 来源、服务商、模型和Key锁定 |
| 编辑与取消 | 切provider清空新Key输入；取消不改已应用配置；已有Key不回填DOM |
| fixture调用归属 | 总6次：personal5/default1；personal预留均为0 |
| fixture共享余量 | 18→17次，¥0.90→¥0.85；不是生产余量或实际扣费 |
| 390像素布局 | `document.scrollWidth=375 <= 390`，无页面横向溢出；截图`outputs/liubai-multi-mobile.jpg` |
| 离页再返回 | 到无默认服务页面后再后退，API Key为空、当前选择未配置；未采集`event.persisted`，不宣称实际BFcache恢复事件已触发 |

### 独立慢响应取消与迟到候选

本case运行在独立4181 fixture和独立内存账本，仅1次personal模拟调用，`reserved_micros=0`；不能混入4180的六次fixture计数。

- 模拟候选延迟20秒，用户先取消并转为本地整理，随后改写整理文本。
- 后台最终记为`finished/candidate`后，页面仍保留用户原编辑文本；迟到候选未覆盖它。
- 此case为假供应商响应，没有真实模型调用或费用；后台候选完成不等于前端有权采用它。

### 当前剩余步骤

- `completed`：四家协议适配、来源和费用门禁、旧账本迁移测试与本地及生产执行、143项自动化、严格校验、上述桌面/390像素/离页返回/迟到响应离线检查、最终构建、版本5发布及正式设置验收。
- 实际BFcache恢复事件未单独取得证据，前述离页返回检查不扩大为该事件已验证。
- `not started`：四家真实账户可用性、真实语义及纠正质量、真实token用量和账单。需使用可用的对应官方账户，Key仍由用户在页面自行输入，不在聊天提供。

### 版本5发布与生产验收

| 发布证据 | 结果 |
| --- | --- |
| 精确发布源 | `7f32ef7f178d169558b29ded3218833e9ef97ffa` |
| 保存版本 | `appgprj_6ae36b991cbc8191b1da8189a33a0d1c~appgver_31656823cd508191835840cf80e599da` |
| 部署 | `appgdep_6ae4b89599ac8191b327fb5cd1372393`，`succeeded` |
| 环境revision | 1 |
| 正式设置 | `https://blank.sakura.observer/?settings=ai`浏览器显示四家服务商和通用「API Key」，无登录门槛 |
| 正式截图 | 工作区`outputs/liubai-multi-live.jpg`，不含真实Key |
| 生产状态 | HTTP200，`configVersion:multi-v1`、`consentVersion:multi-provider-v1`、`enabled:true` |
| 默认服务 | `defaultAvailable:false`、`defaultEnabled:false`、`defaultProfile:null`，尚无组织者默认配置 |
| 共享余量 | 16次、保守预算¥0.80；不代表供应商账户余额或实际费用 |

通过Sites数据库overview和rows验证`source_mode/provider_id/model_id/price_version/reserved_micros`五个新增列存在；旧两条记录仍为fallback，每行预留50000微元，provider/model为null。`source_mode=default`仅为旧共享口径的兼容迁移值，不能据此推断旧请求实际使用默认Key。原两行没有删除、重置或重新释放，也没有新增真实调用。

本次精确源码已推送Sites原生托管仓库，不据此声称GitHub已同步；继续使用Sites托管，没有迁移至用户自管Cloudflare账号。143项、构建、迁移及离线mock证据保持成立；真实四家质量、纠正效果、用量与账单仍未验。
