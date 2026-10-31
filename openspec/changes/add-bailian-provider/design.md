## Context

现有四家目录从server-owned definitions同时生成共享route和公共catalog；个人未知ID走WeakSet签发的generic route。前端有厂商白名单，设置依赖目录，同意使用实际providerLabel。独立生产Worker直接复用这些模块，默认配置未开通；动机见proposal。

## Goals / Non-Goals

**Goals:** 最小增量第五家，保持个人Key生命周期与select节点稳定、提示词和候选校验，固定百炼北京账户边界。

**Non-Goals:** 不增加任意Base URL、Workspace输入、海外地域、模型发现、共享默认百炼、套餐Key或真实扣费测试。

## Decisions

1. providerId使用 `bailian`，label为“阿里云百炼”，preset为用户截图且官方已说明的 `qwen3.8-flash`。公共catalog可带personalOnly，构建共享routes必须显式排除personalOnly；百炼全部个人route为generic、system、personal-unpriced-v1、reserve0、费率null。保持旧四家价格及参数不变，不把未知价格猜成免费。
2. 固定 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`。官方仍支持此标准域名，Workspace专属域名不是本轮必填，避免开放任意终点与多余配置。[地域](https://help.aliyun.com/zh/model-studio/beijing-access-information)、[兼容](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)。
3. 仅精确ID `qwen3.8-flash`、`qwen-plus`、`qwen-flash` 设置 `enable_thinking:false`。新模型及未知自填百炼请求采用 `max_completion_tokens` 限制完整输出；精确旧别名qwen-plus/qwen-flash使用max_tokens且关闭思考，避免未知思考开销。百炼统一2000上限，其他模型是否接受仍以供应商为准，不自动重试。均不发response_format、厂商原厂thinking、cache或OpenAI store参数，返回仍需相同JSON候选验证。[Chat参数](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[思考](https://help.aliyun.com/zh/model-studio/deep-thinking)。
4. 前后端版本仍multi-flex-v1，同意multi-provider-v1。新增目录字段向后兼容，旧前端会忽略新厂商但四家不中断。前端同时拒绝把bailian归一化为defaultProfile，个人查找路径显式允许。
5. 失败沿用受控HTTP枚举；如官方代码证据明确，可将百炼免费额度耗尽/欠费映射到现有余额或额度不足提示。只比较有限code，原始错误不进入日志或页面。

## Risks / Trade-offs

- 未做真实Key推理 → 假模型覆盖路由、参数和验证，发布后由用户在本页输入Key验证实际模型权限，不声称真实语义/费用已通过。
- 任意模型不代表能力统一 → 关闭思考限定精确集合，未知模型拒绝不支持参数时受控回退；思考专用模型可能在输出上限内无有效正文，不擅自加大上限。
- 地域不同会鉴权失败 → 维护文档记明北京标准端点；按用户要求界面仅显示阿里云百炼，保留原话，不自动切地域。
- 增量目录触发旧测试默认假设 → 测试区分共享目录与个人目录，不扩大共享可计价模型集。

## Migration Plan

1. 合成测试验证新旧route、参数/redirect、候选、费用隔离和Key生命周期，浏览器验证百炼preset+custom及实际收件方同意。
2. 记录生产共享状态基线，精确commit后通过既有deploy:standalone发布同一个Worker/D1；保留verified与正式route。
3. 核对生产五家目录、bundle资产及匿名界面、共享基线；需要回退则使用已核验旧Worker版本并保持同一D1，不恢复旧账本。
