# 多服务商接入依据

## 百炼增量依据（2026-10-31）

新增个人目录 `bailian`，界面仅显示“阿里云百炼”，预选 `qwen3.8-flash`，也支持合法的自填模型Code；不将百炼加入默认共享模型目录，不猜测用户免费额度或模型费率。

- [北京接入信息](https://help.aliyun.com/zh/model-studio/beijing-access-information)及[OpenAI兼容说明](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)：原标准域名仍支持，北京Key只配对应地域。先使用固定 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`，不让访客提交地址或Workspace域名。地域属于后台配置，按用户要求服务商名称不显示地域括号。
- [Chat参数](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)及[思考模式](https://help.aliyun.com/zh/model-studio/deep-thinking)：HTTP扩展字段放顶层；仅精确 `qwen3.8-flash`、`qwen-plus`、`qwen-flash` 关闭思考。新模型及未知模型使用完整输出的 `max_completion_tokens:2000`，两个旧Qwen别名采用 `max_tokens:2000` 且关闭思考；不同时设置两种上限。其他模型不盲注 `enable_thinking:false`，例如GLM5.3不能关闭，Kimi3官方资料有差异。未知模型的实际兼容性仍需账户验证。
- [错误码](https://help.aliyun.com/zh/model-studio/error-code)及[免费额度规则](https://help.aliyun.com/zh/model-studio/new-free-quota)：只将403的 `AllocationQuota.FreeTierOnly`、400的 `Arrearage` 归为现有账户额度/余额不足提示；其他权限失败保持原分类。只读有限error.code，原错误体、Key和用户材料不回显或入日志。

百炼走同一system场景规则、JSON候选/evidence校验、manual拒重定向和Key生命周期；个人共享预留为0不代表实际免费。保留配置 `multi-flex-v1` 与同意 `multi-provider-v1`，原四家仍兼容。以下2026-10-30内容是原四家固定共享模型的依据，不把其费率、专有参数或成功声明套用于百炼。真实Key、真实推理质量与实际账单不由模拟测试替代。

核验日期：2026-10-30（Asia/Shanghai）。模型与价格可能变化，目录的有效窗截至北京时间 **2026-11-06 00:00**；服务端到期拒绝推理。下列记录是接口依据，不是四家真实账户已成功调用或复盘质量通过的证据。本轮协议测试均拦截出站、使用假 Key。

## 首批固定路由

| 服务商 | 模型 | 固定 Chat Completions 端点 | 平台选定参数 |
| --- | --- | --- | --- |
| DeepSeek | `deepseek-flash` | `https://api.deepseek.com/chat/completions` | system、`thinking.type:disabled`、`max_tokens:1000` |
| Kimi 中国站 | `kimi-k3.1-pro` | `https://api.moonshot.cn/v1/chat/completions` | system、`reasoning_effort:low`、`max_completion_tokens:2000`、5m 缓存 |
| GLM 智谱中国站 | `glm-4.7-flash` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | system、`thinking.type:disabled`、`max_tokens:1000` |
| OpenAI | `gpt-6-luna` | `https://api.openai.com/v1/chat/completions` | developer、`reasoning_effort:none`、`max_completion_tokens:1000`、`store:false`、`service_tier:default` |

四家均使用 `stream:false` 和 `response_format:{type:json_object}`。平台只采纳 `message.content` 解析出的 JSON 候选，再经同一来源、结构和阶段校验；不发送工具。全部请求固定 12000 UTF-8 字节上限，实际 prompt 用量检查界限 13000 tokens。

## DeepSeek

[官方中文模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) 核实当前 `deepseek-flash` 对应 Flash 模型、支持非思考及 JSON；采用高峰人民币价格，每百万输入缓存未命中 **¥2**、输出 **¥8**。不依赖空闲时段或缓存折扣。

[Chat Completions 参数](https://api-docs.deepseek.com/api/create-chat-completion/) 支持 system/user 消息、`thinking.type:disabled`、`max_tokens` 和 JSON Object。只使用官方端点，不接订阅登录令牌或代理地址。

## Kimi

[K3.1 Pro 指南](https://platform.kimi.com/docs/guide/kimi-k3-1-pro-quickstart) 核实模型及中国站端点；模型始终思考，使用低推理强度，不发送旧 `thinking` 开关。小额输出界限下是否稳定完成复盘 JSON 尚待真实验证。

[官方定价](https://platform.kimi.com/docs/pricing/chat) 的页面表格数据核实：每百万输入 **¥13**、输出 **¥68**，5m 缓存写入 **¥13**，1h 写入 **¥26**。适配器固定 5m；不依赖命中优惠。该页同时公告 K2 系列从 **2026-10-31** 不再向新用户开放、计划 12 月底全下线，因此不选 K2.6 作默认。

[Chat API 用量说明](https://platform.kimi.com/docs/api/chat) 说明 completion 已含推理与正文；不再额外累加 reasoning tokens。缓存读取、写入和未缓存三类相加为总 prompt。只解析正文，不持久化思考文本；每次由平台重新构建独立的上下文快照。

[Kimi 错误码](https://platform.kimi.com/docs/api/errors) 区分 429 的额度不足与限速，并说明中国站与国际站账户及 Key 不互通。入口仅接中国站按量 API Key，Kimi Code 及会员不等同此服务。

## GLM

[GLM-4.7-Flash 模型页](https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash) 核实固定模型和端点，支持文本、JSON 及对话。[思考模式](https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode) 支持该系列关闭思考；新 5.3 系列强制思考，不作为此轮默认。

[智谱价格页](https://docs.bigmodel.cn/cn/guide/start/pricing) 列出 4.7 Flash 输入、输出与缓存命中免费；仍保留应用门禁及最低共享预留，不将免费解释为无限可用。

[结构化输出](https://docs.bigmodel.cn/cn/guide/capabilities/struct-output) 和 [对话补全](https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8) 提供 JSON Object、system 消息、`max_tokens` 和三项用量字段。

[标准 API 介绍](https://docs.bigmodel.cn/cn/api/introduction) 区分标准 API 与 Coding 产品 Key。[业务错误码](https://docs.bigmodel.cn/cn/api/api-code) 中 1113 为欠费，1302/1305 为限速或繁忙，1211 为模型不存在。仅受限读取 code，原始错误不进入响应或日志。

## OpenAI

[GPT-6 Luna 官方模型页](https://developers.openai.com/api/docs/models/gpt-6-luna) 核实模型、Chat Completions、结构化输出及 none 推理档。标准每百万输入 **$0.10**、缓存写入 **$0.125**、输出 **$0.50**。

[Chat Completions 参考](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) 提供 developer 消息、completion 界限、JSON 输出和 `store:false`。显式 `service_tier:default` 使用标准处理，避免沿用项目 auto 配置选择加速档。

## 预算界限与证据边界

目录费率均为预算假设的上界：DeepSeek 人民币高峰价；Kimi 默认 5m 输入价；GLM 当前免费价；OpenAI 使用 **USD 1 = CNY 10** 的保守折算假设并纳入 1.25 倍缓存写入，即每百万输入按 ¥1.25、输出按 ¥5。这不是实时汇率或实际账单。

| 模型 | 13000 输入 + 设定最大 completion 的估算上界 | 共享单次预留 |
| --- | --- | --- |
| DeepSeek Flash | ¥0.034 | ¥0.05 |
| Kimi K3.1 Pro | ¥0.305 | ¥0.40 |
| GLM 4.7 Flash | 当前 ¥0 | ¥0.05 |
| GPT-6 Luna | ¥0.02125 | ¥0.05 |

个人 Key 自费，不占共享次数或共享金额；共享来源沿用 18 次及 ¥0.90 预留上限，另留 ¥0.10 余量；两种来源都受每会话 5 次、全局并发 2 次及单次请求边界约束。字节加余量并非精确分词计费，预留亦非供应商账单硬上限，实际用量越界须停用并核查。

所有调用均使用 Workers 支持的 `redirect:manual`，明确拒绝 3xx、opaque redirect、已重定向响应及 URL 变化；不重试、不切换服务商或付费方。[Workers Request 文档](https://developers.cloudflare.com/workers/runtime-apis/request/) 是这一运行时边界依据。四家参数、错误、字节界限、取消、用量及真实 Workerd 的出站拦截测试通过仍不能代替账户权限、真实语义质量及账单验证。
