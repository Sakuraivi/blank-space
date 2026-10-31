## Why

四家个人Key目前各自仅能使用一款预设模型，平台测试目录被错误用作个人账户的选择上限。用户明确要求DeepSeek、Kimi、GLM、OpenAI共用灵活模型选择，且个人付费不得受默认共享预算限制。

测试人员访问自有子域名仍遇到 `chatgpt.site` 边缘安全拦截；公开权限与本机HTTP 200不能证明其网络可达。用户已明确同意迁至自己的Cloudflare账户，本变更同时纳入独立托管、历史账本迁移和可验证切换。

## What Changes

- 四家个人来源均支持预设模型与合法的自填模型ID；保留固定官方端点，不接收任意Base URL。
- 默认来源继续只接受经适配且有费用预留的服务端目录。个人未知价模型不伪造价格或账单，保留请求、Token、会话、并发和候选校验。
- 个人异常只拒绝本次，不持久停用共享服务；默认来源用量异常仍维持原熔断。
- **BREAKING**：公开配置版本升级为multi-flex-v1，旧页面重新加载；付费方、接收方与同意含义不变。
- 本轮统一采用“预设+自填ID”，不承诺四家实时模型目录；目录查询需另验证各官方接口。
- 在用户Cloudflare账户建立独立Worker/D1候选；旧Sites先进入维护并排空在途请求，完整复制冻结快照及预算历史，核验后才开放候选与切换 `blank.sakura.observer`。
- 保留旧Sites冻结回退；候选产生新账本后回退须先冻结并合并增量，不得重置共享额度或让两端同时生成。不升级付费、不触发真实模型调用。

## Capabilities

### New Capabilities

- `personal-model-choice`：四服务商个人模型ID、官方路由、费用隔离和统一复盘约束。
- `independent-hosting`：自管Cloudflare候选、维护与快照迁移门禁、域名切换、冻结回退及访问证据边界。

### Modified Capabilities

无已归档同名能力。本变更显式替代multi-provider-ai中的个人模型仅限目录和禁止任意模型输入的范围；对默认来源及任意端点的限制继续有效。

## Impact

涉及ai/providers、provider-transport、ledger/diagnostics、server/api、公开设置和Key偏好及测试，以及独立Worker/D1部署配置、迁移核验与域名路由；不重置D1或自动读取、调用真实Key。独立部署配置及构建来源需可复现，临时 `work/` 包不是最终源码依据。旧边缘命中规则尚无Ray ID证据，不擅自关闭安全规则；去除 `chatgpt.site` 依赖不等于保证所有网络可达，访问拦截是否修复须由原受阻测试者验收。
