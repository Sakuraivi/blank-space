# 2026-11-01 线上内测交付

状态：发布准备 completed；独立内测发布 completed；完整线上AI验收 blocked（默认服务上游余额/额度拒绝，需用户恢复）。

## 交付范围

- 测试入口：https://blank.sakura.observer/clarity 。当前建议测试一件具体困扰的梳理、纠正、提前整理、保存和导出。
- 默认首页沿用旧版；片刻、选择、所有自选模型容量及首次用户任务仍待完整验收。不是全场景正式版。
- 复用当前组织者默认服务；不重置Key、口令、共享账本、预算配置或数据库。已有全站2并发保护，首轮分批体验。
- 新版记录使用独立位置；旧记录作为首次副本来源，后续两版不自动同步，旧版原始存储不被新版写入。

## 发布前证据

- 新版定向检查51/51，含v1/v2契约共存及3个记录隔离用例；独立Worker关键检查8/8。未运行旧版全量回归。
- 远程默认服务enabled=true；D1 migrations list --remote返回无待应用迁移。
- 当前线上回退版本：`ef6fc7c4-9127-4944-8f77-c6f3ec3f3899`，2026-10-31T06:54:34.640Z。其管理凭证与现有Secret绑定已经存在，可作为本轮代码/资产回退。
- 旧首页和后台HTML差异仅边缘注入的既有统计脚本；旧app.mjs除换行外一致，core.mjs字节一致；共享ai-settings.mjs新增两个具体错误说明。无旧首页结构变更。
- 上传保留远程变量；使用同一Worker/D1/域名。仅发布代码与静态资源，不执行D1迁移或配置写入。

## 发布后证据

- 部署源码提交：`a537477`；Cloudflare当前Worker版本：`585b6ac3-5431-4ffb-a82f-8030285bc523`，标签`liubai-clarity-beta-20261101`。使用`--keep-vars`，未写组织者配置/凭证或执行数据库迁移。
- `/clarity`、新JS入口及其5项静态模块依赖、两层CSS均200且MIME正确；字体分片200/font/woff2。默认公开状态enabled=true、defaultRevision=1；这仅证明配置就绪，不代表上游账户额度可用。
- `/api/organizer/session`未登录authenticated=false；`/api/organizer/status`未登录401/auth_required；旧OAuth入口404；旧首页200，继续旧app入口。
- 通过未登录的真实生产API提交一次虚构C01首轮，HTTP200返回fallback，reason=`provider_balance_low`，耗时3904ms，requestId=`e0e45adc-12fb-4c4f-ba17-223bcc4c00ff`。映射可能包含余额不足或免费额度限制，未读取上游原始私密错误，也不能据此断言具体账单原因。未继续重试，不把这个HTTP200当作AI成功。
- 合成请求与安全响应保存于忽略目录`work/beta-release/live-smoke.json`。后续对话、线上保存/刷新/PNG导出未到达，不能标为线上验收通过。
- IAB的页签API读取/截图超时，未因此推断站点被拦截。computer-use的原生窗口确认实际线上首屏已正常渲染，能看到默认“开始聊聊”，没有ChatGPT登录页；截图仅裁切出浏览器区域以排除其他聊天，保存于`outputs/liubai-live-beta-home.png`。未使用本地样例伪装线上截图。

## 复测与配置边界

- 用户回复可复测后，只执行一次默认服务首轮请求：HTTP200/fallback，reason=`provider_balance_low`，耗时10688ms，requestId=`a69800ff-9d5c-40cd-938e-9cb1acdbe11f`。路由仍为百炼`qwen3.8-max`、默认配置版本1，未继续重试。合成结果保留于忽略目录`work/beta-release/live-smoke-20261101-recheck.json`。
- 随后用户明确：只在网页“AI 设置”填写个人Key。这不会修改后台共享配置，因此不能把这次操作记作默认服务已恢复；也不能用默认服务失败推断个人Key不可用。
- 实际线上`/clarity`首屏显示“费用由你的服务商账户承担”和“设置已确认，还没有发送你的文字”，说明当前页已选个人服务；这不是上游成功证据。个人Key未读取、提取或复制至请求脚本，原有标签页未刷新。
- 页面控制连续超时，原生窗口操作又遇到窗口位置变化，未确认填写或发送成功，不能将尝试记作浏览器验收。已保留标签页，等待用户在现有页面提交一次并反馈实际结果。
- Node烟测只覆盖生产API与本地状态模块，内存序列化不是浏览器localStorage；不能据其通过宣称实际保存、刷新重开、PNG导出或内容质量通过。

## 剩余动作

1. 个人试用：在已配置的现有页面直接试聊，不刷新；先确认能正常回应和追问，再检查整理、保存、刷新重开及PNG导出。
2. 朋友免填Key体验：用户在`/admin`保存有额度的共享Key和模型，或恢复原默认服务，再执行默认链路复测。个人设置不会自动转为共享服务，不在聊天发送Key。
3. 首轮朋友任务及记录表已准备，见[beta-test-kit.md](beta-test-kit.md)；实际无指导测试仍为not started。默认链路和浏览器完整验收通过后，再逐人开展5位测试。

上游报错的可能原因及处理依据：[百炼官方错误码说明](https://help.aliyun.com/zh/model-studio/error-code)。`AllocationQuota.FreeTierOnly`表示免费额度用完且受用完即停规则限制；本次平台只返回归一化原因，尚不能确认具体错误码，不据此自动充值或修改计费设置。
