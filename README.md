# 留白 · 生活片刻整理

从一件生活小事开始，经关注点、可选图像卡和最多三个问题，留下一份自己修改并确认的记录。默认保留本地流程；AI 提供可纠正的候选理解。

- [体验入口](https://blank.sakura.observer)
- [源码仓库](https://github.com/Sakuraivi/blank-space)
- [Sites 备用地址](https://liubai-little-moments-sakura.zhengjuzhong3.chatgpt.site)

## 本轮进度与线上版本

2026-10-30：`warm-public-ai` 已作为 **版本 3** 发布到 [blank.sakura.observer](https://blank.sakura.observer)。公开个人设置、个人/默认凭据选择和暖感界面均已上线；最终 **93/93 自动化通过**、最终构建退出码 0、OpenSpec 严格校验通过。完整证据见 [QA.md](QA.md)，剩余真实模型验收见 [任务清单](openspec/changes/warm-public-ai/tasks.md)。

- 发布源提交：`4fd788f45bc2dea025f1b6bfcd1fa4d93a038380`。
- Sites 版本：3；部署 `appgdep_6ae4a83fdebc8191ac2918a151b07cad` 返回 `succeeded`，环境 revision 为 1。
- 正式域名已在浏览器显示新版标题、原创生活插画与公开 AI 设置，旧 `/admin` 入口自动进入公开设置，无 ChatGPT 登录门槛。
- 生产 `/api/ai/status` 返回 `enabled:true`、`personalKeySupported:true`、`defaultAvailable:false`、`configVersion:public-v1`、`remainingCalls:18`、`inviteRequired:false`。这里的 enabled 表示可以使用个人 Key，不代表组织者已提供默认 Key。
- 旧 `/api/admin/status` 仍返回应用 JSON `403 admin_required`，公开个人设置不会开放全站配置权限。

**真实 DeepSeek Key 尚未提供，没有真实模型调用费用或质量/账单验证。** 现在可由用户在公开设置自行填写个人 Key；若希望朋友留空也能使用，组织者还需在托管秘密项补一次 `LIUBAI_DEFAULT_DEEPSEEK_KEY`。本轮沿用 Sites 托管，并未迁到用户自己的 Cloudflare Workers 账号。

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
