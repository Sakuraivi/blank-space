## Context

见 proposal.md。v4固定DeepSeek；公开个人Key仅页面内存，默认Key由环境或旧加密配置提供。D1已有两次失败尝试，每行按0.05元保守占用；真实模型内容和账单未验。当前价格有效窗仍截至北京时间2026-11-06 00:00。

## Goals / Non-Goals

**Goals:** 四家官方路由、完整绑定的来源/服务商/模型/Key设置、相同平台规则、迁移后仍有效的预算门禁。

**Non-Goals:** 任意代理URL、模型列表自动探测、共享订阅代理、跨设备保存个人Key、自动failover、此轮自动消费真实Key进行四家评测。

## Decisions

1. 服务端`ai/providers.mjs`拥有模型白名单、端点、参数、费率和试用边界；状态接口仅投影公开目录。首批优先每家一款官方可用、非思考或低成本模型，最终名称以官方核验为准。相比任意模型输入，白名单使费用和能力可验证。
2. 设置来源显式为`default`或`personal`。个人模式完整绑定providerId/modelId/key；默认由环境`LIUBAI_DEFAULT_PROVIDER`（默认deepseek）和对应`LIUBAI_DEFAULT_<PROVIDER>_KEY`提供，模型由目录默认值或合法配置决定。仅DeepSeek兼容旧D1默认；其他服务商不会借用它。相比留空即隐式跨平台切换，显式来源降低接收方和付费方混淆。
3. 公开接口升级`configVersion:multi-v1`、`consentVersion:multi-provider-v1`，返回providers及defaultProfile。生成携带sourceMode/providerId/modelId；响应回显route并由前端核对。route参与摘要但Key及Key摘要不参与。
4. 公共设置暂存编辑，不读取已存Key填入DOM；更换服务商清空新输入，只有完整应用才替换已应用三元组。活动会话冻结路由；pagehide同时清除设置和会话副本。
5. 复用可配置的受限Chat传输以避免复制超时、字节上限和重定向保护，参数与错误映射仍按provider区分。OpenAI使用developer消息、max_completion_tokens、reasoning_effort:none、store:false；其他服务商按官方契约。统一JSON候选仍通过程序校验，不保证语义正确。思考正文不展示不记录，用量必须包含计费completion。
6. 用户已确认默认共享预算与个人自费分开。追加schema-only迁移，给账本增加source_mode/provider_id/model_id/price_version/reserved_micros；历史source_mode默认default、预留默认50000。默认来源原子INSERT同时检验默认来源SUM(reserved_micros)+本次预留<=900000、共享18次以及通用5/2；个人来源预留0、不受共享18次和金额限制，但仍受5/2和单次请求边界限制。模型按完整请求字节上限、额外1000输入token余量、最大completion与官方费率计算默认保守预留，最低50000并向上取整；美元使用预算假设的保守折算缓冲，非实时汇率或账单。共享失败不退款；实际usage越界记error并持久停用。
7. 保留同源、取消、迟到丢弃和原话回退。受控诊断只增加白名单provider/model元数据；不记录原始错误、凭据、原文或模型输出。旧管理API保持保护且只管理旧DeepSeek配置。

## Risks / Trade-offs

- [官方模型和价格可能变化] → 保存核验来源和价格版本、沿用短有效窗；到期拒绝推理。
- [不同账户权限及地区端点不同] → 仅支持明确列出的官方平台与端点，Key可用性以实际受控结果为准，不猜测或切代理。
- [按字节估算token并非精确计费] → 加输入余量、费率缓冲和批次余量，记录实际usage；不把预留描述成实际扣费或供应商硬上限。
- [高价模型更快占用默认预算或个人余额] → 明确付费方与模型提示，默认预算不足即拒绝；不宣称共享剩余次数均可用于任意模型，个人调用不受共享额度约束但有明确请求边界。
- [多适配器离线测试不证明真实内容] → 分开记录离线协议验证、浏览器行为与待用户提供可用账户后的真实质量验证。

## Migration Plan

更新Drizzle schema并生成追加迁移，不改旧SQL或历史行；先在本地旧账本迁移验证，再全量回归和构建。Sites发布先应用迁移再上传Worker。新列均有常量默认或可空，回滚v4代码仍兼容，不能回滚或重置历史预留。发布后核验公开目录、默认来源、原调用计数和正式域名设置，不自动发起付费推理。
