## Why

用户已有北京地域的阿里云百炼Key及模型额度，现有四个服务商均连接原厂端点，无法使用百炼账户。需要在现有个人Key路径新增明确的百炼入口，避免把模型品牌误当成实际收件方和付款平台。

## What Changes

- 新增个人服务商 `bailian`，显示“阿里云百炼”，固定官方北京DashScope兼容端点。
- 预选 `qwen3.8-flash` 并支持现有自填模型Code；为已核实的Qwen轻量模型关闭思考，未知模型不盲注厂商参数。
- 百炼只走个人Key、零共享预留及未知价格口径，默认来源不得选择百炼或回退其他Key。
- 继承平台system提示词、候选/evidence校验、限长、同意、幂等及Key离页清除；保留原生服务商select节点。
- 增量目录沿用 `multi-flex-v1` 及既有同意版本；新旧四家仍兼容，刷新后出现第五家。
- 通过假模型验收并发布现有Cloudflare Worker；不改DB、正式域名、共享预算或运行秘密，不调用真实模型。

## Capabilities

### New Capabilities

- `bailian-personal-provider`：百炼北京个人模型选择、官方路由、费用隔离、提示词/校验及发布验收。

### Modified Capabilities

无已归档同名能力；增量扩展现有多服务商个人模型能力，不改变原四家约束。

## Impact

涉及 `ai/providers.mjs`、`ai/provider-transport.mjs`、公共设置目录及相关测试，可能补充API和诊断测试。使用现有独立Worker/D1部署，schema与历史账本无需迁移。北京之外地域、业务空间自定义域名、Coding/Token Plan、模型目录自动发现、付费推理验证和组织者百炼默认Key均不在本轮范围。
