# 验证记录

## 百炼接入（已发布）

日期：2026-10-31（Asia/Shanghai）。契约：[add-bailian-provider](openspec/changes/add-bailian-provider/design.md)。本节为新增第五家，不改下方迁移历史。

- 个人目录新增 `bailian`，界面仅“阿里云百炼”，预设 `qwen3.8-flash`，支持合法自填模型Code。固定官方北京标准DashScope端点，百炼共享路由始终不存在；全部百炼个人route费率null、预留0、personal-unpriced-v1。未改变旧四家参数、共享预算或数据库schema。
- 百炼只有精确qwen3.8-flash/qwen-plus/qwen-flash关闭思考；两个旧别名用max_tokens2000，其余百炼用max_completion_tokens2000。不会给glm-5.3、kimi-k3或未知ID盲注关闭参数。403 FreeTierOnly、400 Arrearage按有限error.code映射既有余额/额度不足提示，不回显原错误体。
- 全量 **186/186通过**，包含原179项及本轮新增后端6项、前端1项。Workerd矩阵涵盖4共享、5通用个人和百炼preset/glm-5.3/kimi-k3的成功与302；百炼default无出站。API检查system场景指令、候选/evidence校验、实际同意、幂等、个人错误不熔断共享，源码独立审查未发现P1/P2或契约缺口。
- 本地4187隔离fixture完成预选Qwen3.8 Flash及自填glm-5.3两次完整候选流程，同意均显示百炼收件方与个人付款、原文续接保留；请求metadata为system+JSON、max_completion_tokens2000，只有预选Qwen关闭思考。两行账本均personal、finished/candidate、reserved0，fixture共享仍18次/¥0.90，不冒充生产余额。
- 本地跨厂商切换清空新Key与模型，取消重开恢复百炼glm-5.3；刷新后临时Key及应用选择清除，不再显示移除Key按钮。原生键盘End/Enter选择百炼后焦点仍在原select。未修改app中的select稳定修复。
- 390px页面宽375，无横向溢出，footer位于707–771px/844px视口内；自填字段与提交操作可用，随后恢复默认视口。工作区截图 `outputs/liubai-bailian-settings-local.jpg`、`outputs/liubai-bailian-candidate-local.jpg`、`outputs/liubai-bailian-settings-mobile.jpg`。非真机或系统原生弹层的完整人工验收。
- 发布前匿名生产基线2026-10-31 04:58:47 UTC：enabled true，multi-flex-v1/multi-provider-v1，默认未配置，共享16次/¥0.80，四家目录。发布使用原Worker/D1及verified/正式域名绑定，不读取真实Key、不推理、不改变运行秘密或额度。standalone dry-run67.03KiB通过。精确源码 `c98ffe03ae26771dff154c741804be9c5387078c` 已部署到既有Worker，正式版本 `445d832e-8ebe-4063-8d3e-8887a5105e6c`，命令退出0，verified、D1及域名绑定保留。05:06:19 UTC独立匿名验收10项均通过：五家目录、百炼精确名称及preset/custom/personalOnly、默认未配置、16次/¥0.80不变、页面200无登录、app及ai-settings资产hash匹配、伪造admin404。正式浏览器已选中百炼并显示Qwen3.8 Flash和空Key字段；截图 `outputs/liubai-bailian-settings-live.jpg`。

实现、本地验收、独立审查、构建、发布及正式核对均 `completed`。下一步：用户在正式页面自行填写百炼Key，验证账户实际模型权限及复盘效果；本轮未读取Key或执行真实付费调用。

## 本轮：灵活模型、独立托管与服务商选择修复（已发布）

日期：2026-10-31（Asia/Shanghai）。本节仅追加本轮证据；下方版本9及更早发布记录保留为历史事实。契约：[personal-model-flexibility](openspec/changes/personal-model-flexibility/design.md)。

### 已取得的本地验证

- 主代理汇总回归 **174/174通过 = 168项应用/后端测试 + 6项独立Worker边界测试**。独立入口覆盖旧管理/OAuth拒绝、伪造Sites身份头剥离、pending/缺库/空账本拒绝、静态资源可用和核验后分发；该结果不是生产迁移完成证明。
- 四家个人服务 DeepSeek、Kimi、GLM、OpenAI 的自填模型 ID 均在隔离fixture完成假响应端到端流程，合计4次个人请求、共享预留0；fixture共享仍为18次/¥0.90。此数字不代表生产余额，既有生产历史基线为剩余16次/¥0.80，迁移不得重置。
- 非法URL模型ID被拒绝；取消设置保留原模型；`ft:`模型ID重新打开可恢复；从故事进入设置、继续到同意仍保留原文；首次提交后模型与确认动作均锁定。以上使用虚构文字、假Key及模拟模型响应，没有真实推理调用或真实供应商兼容性结论。
- 主代理390px视口检查文档宽375，无横向溢出；截图位于工作区 `outputs/liubai-flex-models-mobile.jpg`。未宣称手机真机或辅助技术完整验收。
- 已将离线全列快照核验器纳入 `scripts/standalone/`，命令及快照隔离约定见 [STANDALONE.md](STANDALONE.md)。核验器使用合成数据测试，不读取真实快照；逐表行数/摘要与共享统计都一致才返回 `matched: true`，相同总预算不能掩盖记录或配置改变。
- 新增核验器测试 `npm run test:migration` **4/4通过**，单独于上述174项；覆盖行顺序无关、同总额的行/配置篡改、空账本/重复主键/未知列拒绝，以及CLI成功摘要和解析/读文件错误不泄露输入。语法、diff及 `git check-ignore` 快照隔离规则检查通过。

### 独立生产迁移与访问验收

- 旧Sites版本10精确源 `46d54fd9e7d40f115caba044ee35738933c688eb` 已构建、推送及发布，部署 `appgdep_6ae56e24896c8191a4d20d4198c3d2e8` 成功，环境revision2。`LIUBAI_MAINTENANCE=1` 拒绝生成和管理写入；管理GET不再首次绑定写入。实际POST生成/配置均503 maintenance，状态仍16次/¥0.80。
- 冻结后源表无在途记录，两次读取全列一致且无投影截断。真实源与独立D1全列摘要 `matched: true`：`pilot_requests` 2行，SHA256 `01d88a052494af1e38832040a22f3d0d8e4cb8334dc97e431f8682e4ca00c39f`；`pilot_config` 0行，SHA256 `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`。共享预留100000微元、剩16次/800000微元；未补占位记录或恢复初始额度。原始快照留在仓库外私有迁移目录，不进入Git。
- 用户账户内Worker `liubai-blank` 复用规范源码；D1为 `liubai-blank-db`（`6bc9e1c5-eac1-4c07-ba26-69b920f89ceb`）。先验证pending拒绝，再完成全列核验、激活；生产配置持久化verified及正式域名路由，避免下次正常部署覆盖回pending。
- 2026-10-31 04:38:38 UTC正式 `blank.sakura.observer` 绑定成功，迁移发布版本 `0159a511-523f-4d00-bc09-576bf434ca40`，源码 `7bf6412bfcfdf512dd3f37045d0556e54af92cfc`。原DNS为CNAME→custom-domains.chatgpt.site、仅DNS、TTL300；首次绑定100117冲突后，通过账户控制台移除该条旧CNAME再成功绑定Worker，原Sites仍冻结作为回退资源。
- 初次传播阶段单次检查仍命中旧维护API；04:40:46 UTC匿名复验已命中新Worker：首页/AI设置200且无登录跳转，8项静态资源SHA256与源码一致，状态200/enabled true/multi-flex-v1/四家custom true/16次/¥0.80，伪造管理员请求404，`/admin`303到本域AI设置，Sites登录/回调404；默认TLS校验开启、无Cookie/Authorization。旧原生站仍maintenance。未关闭未知命中规则或触发真实推理。
- 用户随后明确回报“现在可以正常打开”，并在正式AI设置反馈服务商下拉交互；记录为受阻访问的用户验收通过，不外推所有地区、网络均可达。默认服务仍未配置，个人Key需在本页填写，迁移没有读取或转存真实Key。

### 服务商选择修复

- 用户反馈原生下拉选中后重新弹开。原因是change处理替换了包含服务商select的整个设置字段区，并对新select强制focus。修复保留服务商和模型select节点，仅更新模型options、自填区域、Key提示及服务商说明，移除重复聚焦。
- 四家切换均恢复对应预设模型、同步实际服务商说明、清空新填Key并关闭自填区域；不会把另一厂商的Key借用到新选择。相关单测含12种跨厂商组合；本地原生键盘选择后焦点仍在原服务商控件、无错误。
- 最终完整回归 **179/179**（包含独立入口6项、迁移核验4项及新增厂商切换矩阵1项），语法通过。浏览器只使用虚构ID/假Key，未再次触发模型生成。修复源 `7da50f37d291733eed6ba639a06e33b19ffd69bc`，正式修复版本 `00420178-f6c6-4e51-81f0-8d8214b794c9`；04:46:33 UTC匿名核对 `/app.mjs` SHA256 `59b0515131b10d6b9b24c481b0f8a6348fb662b4b6c19ea7be692d28adf6eee9` 与源码逐字节一致，状态仍enabled true及16次/¥0.80。正式浏览器已显示OpenAI自填模型ID字段，截图位于工作区 `outputs/liubai-flex-settings-live.jpg`，未填真实Key。

实现、迁移、域名切换和受阻访问用户验收均 `completed`。旧Sites继续冻结；增量账本回迁的真库灾难演练 `not started`，禁止未合并新消费就解冻旧站。日常代码回退优先在自管Worker复用同一个D1。下一步：刷新正式页面检查服务商下拉的真实交互；原生菜单的系统弹层观感仍以用户浏览器反馈为准。

## 版本9：成品版式与设置操作区（已发布）

日期：2026-10-31（Asia/Shanghai）。本节为当前变更状态，下方版本8及更早章节按当时事实保留。

### 参考与改动范围

- 参考 [Day One 官方功能页](https://dayoneapp.com/features/)，主代理已实际检查其中的编辑器界面图；借鉴单一内容轴和明确的内容层级，不复制其素材。弹窗操作区参考 [Carbon 官方规范](https://www.carbondesignsystem.com/building-blocks/core/components/modal/guidelines)，将字段管理动作与提交、取消分开。
- 示例统一为四个 `.letter-section`，相同小标题、16px正文及左边线；移除缩进引语竖线、右对齐落款、双层纸张及成品胶带装饰。预览仍明确虚构，不保存、不创建记录或调用模型。
- AI设置底部仅「取消／确认设置」两个同高按钮。「移除本页 Key」仅在个人来源且已有页面Key时靠近输入字段显示，仍受锁定禁用及原handler guard约束；清除Key、来源重置和关闭弹窗的语义不变。
- 预览正文、设置 `.ai-settings-content` 分别滚动；标题和底部操作区不随正文滚走。错误区保留原ID及alert，空内容时隐藏。
- 仅前端排版及动作位置调整；后端API、环境、预算、来源路由、凭据生命周期、同意续接和确认保存规则未修改。PNG仍为既有独立canvas排版，不声称已同步此次网页版式。

### 已取得的验证

- 桌面及390px窄视口：文档宽375≤390，无横向溢出；示例四段左边线实测均为x36；底部操作可见。
- 空Key提交后错误显示；应用假Key后「移除本页 Key」按钮为1个，移除后按钮消失且Key为空。默认来源不显示移除动作。
- 全量151/151、语法及diff检查通过。独立只读审查确认新增wrapper不影响来源、provider/model、Key查询及事件委托；设置提交ID、resume gate到同意、锁定guard保持完整；旧预览排版class无悬挂引用。
- 验收使用虚构输入、假Key和隔离fixture，未调用真实API。4185测试账本最终读取为 `rows:[]`。
- 390px空Key报错时错误及footer同时可见；初始心事记录从设置应用假GLM后自动续到同意，启用后仍保留故事。首次提交返回后「确认设置」与「移除本页 Key」均禁用。
- 正文可键盘聚焦，PageDown后scrollTop=18与scrollRange=18一致，已到末尾；焦点为「虚构成品正文」，footer未滚走。手机预览正文scrollWidth=clientWidth=288。
- 工作区截图 `outputs/liubai-order-preview-local.jpg`、`outputs/liubai-order-preview-mobile.jpg`、`outputs/liubai-order-settings-local.jpg`、`outputs/liubai-order-settings-mobile.jpg`；浏览器已恢复默认视口。

### 发布与证据边界

- 最终构建退出码0，发布精确源 `39cfd1a8010502c3e355202e20abeb33fbd39f47` 已推送Sites原生仓库；保存版本 `appgprj_6ae36b991cbc8191b1da8189a33a0d1c~appgver_950b23508d548191884508de624aa8e8`（版本9）；部署 `appgdep_6ae4dd28fcf48191b851f8c67ad18598`，`succeeded`，环境revision1，公开范围未变。
- 正式域名浏览器已显示设置页只有「取消／确认设置」及新示例布局。工作区截图 `outputs/liubai-order-settings-live.jpg`、`outputs/liubai-order-preview-live.jpg`；已保留新版预览页，视口为默认尺寸。
- 生产状态核对默认未配置、共享剩余16次与保守预算¥0.80，与本轮之前一致；本次没有真实推理调用、没有改环境或数据库。Sites推送不等于GitHub同步。
- 移动真机、辅助技术完整验收和真人对阅读秩序、温馨感的判断不由本轮自动化替代；不新增真实模型语义或费用结论。

调研、实现、验收、发布均 `completed`。下一步请亲友判断示例是否规整、设置是否易懂；主观视觉反馈不由自动化替代。

## 版本8：简明设置与来信阅读（已发布）

日期：2026-10-31（Asia/Shanghai）。本轮只修改前端说明与阅读样式，不修改API、预算、路由、凭据存储、发送门禁或确认保存逻辑。

- 设置及同意页面去除共享次数/金额/预算计算、token及思考模式说明。默认可用、默认未开放和个人服务均只保留使用所需的信息；付款方、实际服务商、文字发送、Key离页清除和个人账户失败/超时可能计费的说明保留。
- 修复 `.modal-body p/h3` 后置同优先级规则覆盖预览的字号/颜色。共用 `.letter-paper` 阅读样式后，桌面预览标题27px、手机24px；正文两端实测均16px、31.2px行高、深色 `rgb(73,57,66)`。
- 示例前两段去掉表单式小标题，记忆句轻量强调；虚构说明只在纸张外一处。预览回主题、不开记录、不保存、不调用模型的行为保留。
- 实际本地流程：心事→故事→跳焦点/卡片→提前整理→改标题→确认。390px完成页保留原文与标签，标题24px、正文16px；文档宽375≤390，无横向溢出。无真实模型参与。
- 默认可用的同意页显示DeepSeek和组织者付款；个人GLM应用后同意页显示GLM及个人付款，取消回轻引导。四家服务商选项仍在；没有点击启用后的生成路径。
- 全量151/151、最终语法及diff检查通过；复用既有行为测试，没有添加镜像文案测试。4184独立fakefixture账本为空；未读取用户Key或消耗真实API。
- 截图位于工作区 `outputs/liubai-warm-letter-local.jpg`、`outputs/liubai-warm-letter-mobile.jpg`、`outputs/liubai-settings-simple-mobile.jpg`、`outputs/liubai-warm-done-mobile.jpg`。
- 真实模型语义、手机真机、辅助技术和PNG导出新样式均未纳入本轮；PNG仍为既有独立canvas排版，不宣称已同步网页视觉。

最终构建退出码0，精确源 `7f870a0f4a6b31e75f9f1b5e0194e3c98a9c59ce` 已推送Sites原生仓库；保存版本 `appgprj_6ae36b991cbc8191b1da8189a33a0d1c~appgver_4584c98010fc8191a9f69a035c1e680a`（版本8）；部署 `appgdep_6ae4d8cda6c88191ab3e8244f6a48876` 为 `succeeded`，环境revision1，公开访问范围未变。

正式 `https://blank.sakura.observer/` 点预览显示「一封生活来信」与新的自然段版式；DOM实测标题27px、正文16px。正式截图工作区 `outputs/liubai-warm-letter-live.jpg`。生产状态仍为默认未配置、共享剩余16次与保守预算¥0.80；该数字仅作验证记录，访客设置与同意页面不再显示。未触发真实生成、未迁移数据库或修改环境秘密，GitHub同步未作声明。浏览器视口已恢复默认。

实现、验收及发布均 `completed`。下一步请亲友判断阅读是否轻松及设置是否易懂，不以151项技术通过代替真人体验结论。

## 版本7：主题直接入口与同记录方式选择（已发布）

日期：2026-10-31（Asia/Shanghai）。本节为最新状态；后续旧节按当时的版本和证据保留，不作为版本7已发布或真实模型质量通过的证明。变更契约：[direct-theme-entry](openspec/changes/direct-theme-entry/design.md)。

### 已实现与已验收

- 三张主题卡分别直接显示对应第一问，默认轻引导；首页无通用开始或独立AI开始按钮，也不再呈现主题勾选态。
- 每个主题有三条独立句子开头及对应placeholder。「需要一个开头吗？」保持可选折叠；短句可直接互换，补写后取消保留全文、确认才替换，返回修改仍适用。
- 完整虚构成品预览包含标题、经历、感受或发现和可选小行动。关闭后焦点回首张主题卡；本次浏览器记录为空，预览未创建或保存记录，也未发起生成。
- 默认服务的同意、取消及切回轻引导均保留已写故事；配置或同意后尚无模型请求。首次有效故事提交后返回修改，两种方式按钮的 `isEnabled` 均为false。
- 默认DeepSeek模拟流程直到跳过联想卡才出现一次假模型调用，测试账本预留50000微元。此为离线fixture证据，不是生产扣费或真实供应商费用。
- 个人GLM配置后续接发送同意时，仍保留原choice记录和文字；设置及同意阶段未调用模型。
- 桌面与390像素窄视口验收：窄视口文档宽度375，无横向溢出；已检查图像和主要输入、选择控件的布局。这不等同于手机真机验收。
- 一轮全量回归 **151/151通过**，包含8项 `story-method` gate用例，覆盖首次设置窗口、记录/主题身份、重复意图、取消失效、提交后返回仍锁定、输入revision、重新签发和伪造ticket。
- 独立源审查通过；初始化 `?settings=ai` 的迟到查询已补 `launchState` / `launchGeneration` 及仍在首页条件，防止用户已进入主题后弹出旧设置意图。最终源码语法、151项回归及OpenSpec严格校验通过。
- 独立4183慢状态fixture实测GET status延迟约5秒：初始深链尚未返回即进入心事、补写并点击AI后取消，迟到结果未弹窗且保留最新输入；再次等待AI期间继续补写，最终同意窗取消后保留最新文字；打开设置后立即前进，结果返回后仍在focus且无旧弹窗。此fixture模型账本为空。
- 个人假OpenAI Key应用并启用AI后，将虚构草稿置空以允许离页；离页再返回，个人Key输入为空且无保留Key占位。未采集实际 `pageshow.persisted`，不宣称BFcache事件已触发；初始story过期凭据可重新进入同意的分支有独立源审查，已提交分支保持锁定。
- 预览长弹窗重新打开时重置滚动到顶部，关闭按钮获得焦点；手机预览可在弹窗内滚动并返回主题。工作区截图：`outputs/liubai-entry-mobile-local.jpg`、`outputs/liubai-story-mobile-local.jpg`、`outputs/liubai-preview-letter.jpg`。

本轮全量命令包含新增根目录测试：

```powershell
node --test core.test.mjs public-flow.test.mjs personal-key.test.mjs ai-settings.test.mjs story-method.test.mjs ai/*.test.mjs server/*.test.mjs
```

### 最终发布与正式域名

- 最终精确打包构建退出码0，OpenSpec严格校验和diff检查通过；发布源 `cb57a923fde972c07e61d2cd15e19f633738af05`。
- 保存版本 `appgprj_6ae36b991cbc8191b1da8189a33a0d1c~appgver_c4dac15782dc81919a57ff7c3ce61e19`（版本7）；部署 `appgdep_6ae4ccd0e58881918d971129d10b2e37` 终态 `succeeded`，环境revision1。
- 正式 `https://blank.sakura.observer/` 浏览器显示三张直接入口与「看看整理后的样子」，旧通用开始/AI开始入口消失，模块均成功加载；截图工作区 `outputs/liubai-entry-live.jpg`。已恢复浏览器默认视口并保留交付页。
- 匿名生产状态HTTP200：`multi-v1` / `multi-provider-v1`、enabled true、defaultAvailable/defaultEnabled false、共享剩余16次与保守预算¥0.80，与本轮前既有余量一致。本次未新增真实模型调用。
- Sites原生仓库已推送精确源码。GitHub同步、迁移Cloudflare、配置默认秘密项不在本次变更内；公开范围未变。

### 证据边界与下一步

入口、示例、配置和同意验收均使用虚构文字、假Key和拦截的模型响应，没有真实API调用。未修改服务端、环境变量、数据库或预算。发布后再次确认生产默认Key未配置；没有验证真实账户余额或权限，也没有新增真实语义、用量和账单证据。初始story的BFcache过期分支未取得真实事件证据，该限制保留。

当前：实现、验证、发布均 `completed`。建议邀请朋友做可用性测试：能否直接发现入口、是否理解轻引导与AI的区别、是否愿意留下整理成品。测试本地路径不需要Key；验证真实AI需体验者自行在页面填写可用Key，或组织者另配默认秘密项。

## 以下为早期与既有发布的历史验证

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
# 引导短句切换与首页入口修复（版本6已发布）

2026-10-30：修复故事页引导短句仅首次填入的问题。输入为空或仍为任一未补写的预置短句时，点击其他短句直接替换；已补写内容使用可取消的替换确认。复用现有确认弹窗，其他调用保留默认取消文案。

- 本地浏览器：空→短句1→短句2→短句3→短句1连续互换；光标落在末尾，计数随内容更新。
- 补写虚构文字后：取消/保留不丢输入；确认后替换为新短句。前进到焦点再返回故事，仍可直接切换预置短句。
- 首页：无可用配置只有「设置 AI 服务」；有可用配置为「开始 AI 体验」和弱入口「更换服务」，顶部AI设置保留。
- `node --check public/app.mjs`、现有核心/前端/凭据/设置回归21项及diff检查通过。未新增镜像单测，未调用真实模型；最终构建退出码0。
- 发布源 `6eea3937ffe3ee0c745515fc79e63c8c04c22365`；保存版本 `appgprj_6ae36b991cbc8191b1da8189a33a0d1c~appgver_2ebc925e5fa081918cc08c4469514483`；部署 `appgdep_6ae4bb82c7b48191ba61575b11188599` 终态succeeded，环境revision1。
- 正式域名首页仅显示「设置 AI 服务」；故事页先选择第一条后再点第二条，已替换为「最近我反复想到的一件事是……」。截图 `outputs/liubai-hint-fixed.jpg`（工作区）；部署后未调用模型。

