# 忠实承接与开放追问切片

状态：隔离策略、harness、16项新定向检查 completed，构建/严格规范/独立审阅通过；真实模型 not started，待最终源码冻结后运行。生产、界面与字体不变，整体4/10。本轮不扩展时长guard文法或把它接入所有线上输入。

## Responsibility and scope

v5四个partial暴露出共同问题：中途接话被要求“再说一个区分”，可能为了产出洞察补出排他关系；选择追问找偏好一侧的正例；兴趣重复索取已知目的；标题压缩丢掉决定含义的对象。新策略替换竞争的如何接话段，去掉旧的重复追加段，不再仅在末尾添加禁词。

`clarity-faithful-dialogue-reflect-1`保留v5场景focus、Host缺口与来源约束、七字段schema、完整请求/原生raw/前后时长检查；`clarity-faithful-dialogue-review-1`保留已有原话ledger/三字段私有模型协议和公开编译，仅替换收尾承接说明。总结保留范围、程度、条件；可准确并列已有顾虑，不要求每轮新洞察。选择追问须容纳支持、反驳或无关的答案；兴趣先回答已明确题面，继续时只补真实未知；标题优先事项而非结论。

这是提示词责任，不是语义事实检测器。合法但排除了本人顾虑的候选仍可能通过现有schema，故保留明确负对照并做独立逐句审阅；不添加关键词语义通过器或替用户确认。已有固定收尾和未收尾须有一问的wire要求保持，不宣称实现完全自由闲聊。

## Freeze and evaluation plan

先冻结新策略和定向测试，再读取独立agent的新四例；作者不知道新策略正文，root在策略冻结前不读新正文。最终harness源码须另行冻结，4个新case只把原话送入真实auto/goal=null状态；purpose由Host固定。只有输入与真实状态进入provider，不送case标签、expectedMode、评分要求或期望答案，session使用中性probe索引。不称统计盲测或所有场景准确率。

固定批次最多16个客户端attempt：已有完整四轮4次、v5八个首轮边界、新四个首轮。复杂非邻接时长限定仍如实前置unsupported，预期最多15个模型请求，不替换样例。独立6版本label/签名域/请求ID，真实续步签名、实际问题核对及暂停规则保持；无自动重试、围栏修复、源改写或结果后调词。失败和unsupported不计内容成功。

实际运行前核对生产默认来源和模型仍为百炼DeepSeek0813/revision3；不读取Key或更改组织者配置。单次可信12000B容量不放宽；固定次数是实验长度，不是用户聊天/费用上限。记录实际请求、原生输出、tokens、精确账本、实际可见原话和内存保存/读回；真人温馨感、浏览器存储与PNG本轮未验。未达到完整内容门槛不发布。

## Pending evidence

策略于`caac5f08ba3d9cebba369ea2c8d1dfec1decc7e5`先冻结，root之后才首次读新四例并映射到最终fixture；原独立文件SHA256 `ca68b9669c8a56895dd781e4ef1ff83e74575aeeca9886edb14250d94e3bd613`。只改caseId/text/评审字段的接口命名，没有修改正文或根据新例调词。Host purpose显式进入控制数据，不将其误称为无场景信息的盲测；评审期望和case标签不入provider。

新策略8项+harness8项共16项通过；相关v5 55、v4 26、v3 14、v2集合29和原保留42项通过。生产独立Worker构建dry-run与实验Worker bundle dry-run（294.63KiB/gzip75.92KiB）、严格OpenSpec和独立源码审阅通过，未执行旧版全量回归。fake完整body 10290/11019/11532/7197B，小于原12000B；旧真实context容量也通过，仅证明这些固定历史。负对照仍明确合法语义错误可机械通过。

真实调用前生产只读status200，默认服务仍enabled、百炼`deepseek-v4-pro-0813`/revision3，未读取凭证。真实调用/逐句审阅、精确账本与最终生产只读复核待记录。最终结论将追加，以上运行前计划保留。1.1/4.1 in progress、4.2 not started；无需用户重新配置Key。
