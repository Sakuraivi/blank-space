# v3格式兼容交付（2026-11-02）

本轮6.1边界、6.2实现和6.3线上交付 completed。canonical字段、类型和长度校验保留；移除不必要的输出包装限制，并引入明确的可选空值约定。不是“放过所有格式错误”，也不声称历史间歇失败已根治或故障率已测得下降。

## 处理边界

| 同一请求内可以处理 | 继续拒绝，不猜改 |
| --- | --- |
| 完整单一JSON的json/无标签代码框 | 前后解释、多块、多对象、残缺JSON、重复键（含转义同名）、超过32层 |
| JSON外部BOM与空白 | 字符串正文内部任何文字和空白都不改 |
| 缺省question设null | 显式坏类型不改；reply中实际提问、禁问/重复问题仍检查 |
| 普通reflect且非action缺省claims设[] | review/action缺内容仍失败，finish不强改 |
| 无历史claims时缺省supersedes设[] | 有历史claims时不猜替换；不存在/重复来源和未知字段不删除 |

外框解码是无损表示转换；补空值是限定条件下的契约约定，不混称一般语义修复。所有结果继续经过原有完整校验，客户端收到原七字段canonical候选。正文不会因长度被截短：reply长度还关联下一轮previousReply和实际请求容量，只放宽一个位置会把故障推迟到下一轮。后续若要扩容，应按真实样本端到端调整。

## 责任和诊断

- 传输层只对schema2+json_text解码，先检查完整provider响应、finish_reason与usage；旧flow仍原JSON.parse。无新增模型调用、付费修复、换Key或自动重试。
- Host仅对v3采用可选空值约定，再检查来源、意愿、阶段、原句和长度；原始输入对象不被覆盖。解码成功不能绕过用户要求或形成假的来源。
- 五种固定格式枚举通过受限header/诊断传播，成功和拒绝都可区分“外框已解开”与“候选是否合格”，不写入候选或保存记录。原始模型正文不进入生产诊断。
- invalid_claim/invalid_question按固定detail区分格式与来源；缺明细归内容核对，禁问/禁分析/阶段归交流约定，连接失败独立。不把来源问题误报成可修复格式。

## 证据

- 最终主链122/122，相邻传输/v2/日志61/61；构建dry-run、严格OpenSpec、diff检查及独立审阅通过。没有跑旧版全量回归。
- 真实handleApi＋合成provider测试：fenced/BOM/缺省候选仅一次dispatch和记账，实际Host apply后继续exploring、原reply不变；fenced坏来源、禁问、禁分析、错误finish、字符串布尔、超长reply、额外字段仍拒绝。重复键、坏JSON、截断finish及旧v2不继承兼容均有反例。诊断抛错/拒绝/不完成不改变候选或追加调用。
- 独立只读审查另用5,000个确定性JSON×三种外框做15,000次roundtrip，与JSON.parse一致；仅为解析机制检查，不替代业务验收。
- 本地明确标注“模拟回复”的错误页：分类“交流约定”正确，原话保留，折叠详情可展开，390px无溢出、无浏览器error；计数1次模拟/0次真实，未自动补发。截图已查看，浏览器与预览服务关闭。
- 发布后固定两次真实默认调用：reflect约7.2秒、review约6.5秒，均candidate并实际Host apply。两次原生返回本来合规，formatAdjustments均无，**不能用它们证明兼容命中率或故障率改善**。完整原生请求/响应为自己编写的合成材料，保留在忽略的work/format-compatibility，不读取私人对话或凭证。
- 两个精确requestId与D1核对均finished/candidate：输入3,820、输出329、总4,149tokens；金额未知，不以零预留表示免费。[安全元数据](../../../ai/evaluations/2026-11-02-format-compatibility.json)不含私人正文或Key。

## 发布状态

实现源码`c3c2917166cfb7af03e60282c17af7e9ba633443`，当前100% Worker `6c30a929-3c6e-48cf-a56b-27f64f7ad4fb`；直接回退`749532e0-3edd-458f-b4ba-219b1a8d0831`保留。

四项修改的前端资产hash与本地一致；v3模块no-store，共享模块max-age=0/must-revalidate。`/clarity`为真实页、`/admin`200，未登录管理API401。默认仍百炼deepseek-v4-pro-0813、revision3、enabled；共享调用/预算仍NULL；未更改Key、口令、D1结构、域名或首页。policy6、schema2和formatVersion2保持。

本轮新增三项已交付，原19项中8项完成和内容/真人待办不变，因此CLI计数11/22，不表示产品成熟度50%。后续继续从实际分类错误做定向修复，不扩大调用直到遇到失败，也不靠重发或截正文制造通过。无需用户重新决定配置；现有页面可以继续，需查看新错误分类时可另开线上入口，未保存对话先保留。
