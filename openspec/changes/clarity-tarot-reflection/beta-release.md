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

## 剩余动作

用户在百炼确认默认Key所对应模型的可用额度/计费设置，或在`/admin`更换有额度的默认服务后，回复已恢复/已更换；不要在聊天发送Key。收到明确恢复信息后，再执行默认服务合成对话、确认保存、刷新和导出的完整线上验收。当前可以查看页面，暂不建议邀请朋友做完整AI体验。

