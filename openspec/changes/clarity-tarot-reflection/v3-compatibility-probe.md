# 旧原生结果与新协议的离线兼容探针

状态：in progress。这是5.4 No-Go后已授权的离线定位，不改变5.4结论，不完成5.6。清单仍8/19；研究仍0人。本轮不调用模型、不接真实API或共享账本、不改生产契约、默认模型、Key、UI或保存格式。

## 范围与可重放来源

只读取[固定E模型对照证据](../../../ai/evaluations/2026-11-01-model-comparison-v1.json)中已知FULL的reference/Max/Flash三份结果。固定原live SHA256 a18934bc7727e80f05a71334aeae7867af76a0fef84d75a6344f99b6bfbd8e9b、执行源码29e4983；runner还固定整个评测文档的JSON.parse后JSON.stringify摘要（忽略文件缩进/换行、保留字段顺序），避免仅替换审阅等级或元数据。原有23份候选/1份拒绝、24次真实调用和No-Go均不回填。

核心目标是区分：原生格式不合规、Host映射与来源、成稿权限证据、容量、实际状态与可保存主文。所有原生文字及其顺序保持，不合并、删除或润色两条insight。三份已知结果都看过，属于离线工程复盘，不是新模型评测或盲测。

## 显式映射责任

1. 用未修改的旧E准备器重建实际provider body，核对原capture的context、request、binding和旧结果；重建真实active材料、source spans及问题关联。工厂本身不是响应身份认证器，runner用固定artifact/live摘要建立来源边界。
2. reply/title/分析type/text保留原生值；anchorIds按冻结材料映射为实际sourceId，不按m编号猜u编号。每条保留原锚点、源原句与UTF16位置，推导标记为inferred。
3. event为Host从已核验原句构造；mode/goal来自原Host context，question=null与finish=true来自反事实成稿操作。evidenceIds、derivation与supersedes补齐都单列来源，不冒称模型原生七字段。
4. 重建真实v3 working state，原4条来源、3条实际问题/回答、旧wire claims及status不能静默清空。该capture不含过去review/removed/locked元数据，不能据此实现任意旧保存记录迁移；缺历史时保持不支持，不凭空补历史。

## 权限分支必须分别观察

| 分支 | 观察与判定 |
| --- | --- |
| 原三字段直接交v3 | 仍应被形状校验拒绝，不能因内容有价值放宽正式入口 |
| 新Host普通续说 `begin()` | 默认reflect，无成稿/新增分析授权；映射候选不应成为报告 |
| 直接复用旧 `stage=review` | 新规则把review stage视为Host明确操作，技术校验可能通过；旧受控快照不证明新用户意愿，因此只观察，不apply/save，不标可交付 |
| 新按钮 `begin({review:true})` | 是合法Host操作假设，本身可以授权；没有u5不代表validator必拒，但该按钮在原历史中未观察到 |
| 明示请求u5 | 仅该反事实分支另外添加kind=request“请AI整理成一份。”，不补写回历史；保留4条生活材料与3条问答，核实际request body、完整validator、actual apply、同块多段理解与format2内存保存读回 |

正常按钮操作与自然语句都是合法新Host控制，探针不把二者误写成同一种历史证据，也不据技术通过宣布用户已经许可或认可。

## 核验与反例

- 原reference两条分析75/60字，Host事件228字，共363/480字、3条；仍检查新完整请求12000B及输出2000token约束，不抬上限或裁源。
- 同时映射Max/Flash作为语义负对照：即使结构通过，原FULL遗漏与No-Go也不升级，不新增语义评级。
- 负控制覆盖明确不分析、暂停/结束、旧flow/schema、晚到与来源变更、第四claim、480字总容量、完整路由容量、手改/confirmed块不被后续候选覆盖。
- 所有成功分支标counterfactual=true、newUserReviewObserved=false、nativeV3Verified=false；不伪造新模型回包、计费记录或真实用户保存。
- 若检查页面呈现，使用独立浏览器和单份合成测试seed，说明是程序注入的format2记录；不碰用户IAB、Key、已有记录或真实生成，不把该过程描述成用户导入功能或真人体验。

## 后续判断

完成后只说明“同一文字能否在明确的新Host假设下被表示及保留”。新协议原生生成能否自行遵循、是否持续忠实、有用与温馨，仍需另行冻结验证；不能用反事实通过替代5.6、新人或发布门槛。结果、定向检查、独立审阅与页面证据按实际追加。
