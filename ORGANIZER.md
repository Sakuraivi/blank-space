# 组织者管理

入口：https://blank.sakura.observer/admin ，首页页脚也提供“组织者管理”。使用独立管理口令登录，无需ChatGPT。管理会话最长8小时，退出会在服务端撤销当前会话。

登录资料保存在用户电脑的仓库外私有目录；本次路径由交付消息给出。页面不提供未认证的首次注册或找回入口。不要把本机登录文件、bootstrap备份、真实API Key或运行secret提交Git。

## 配置默认服务

选择服务商与预设模型，或自填模型ID；输入对应共享Key，勾选启用后保存。保存不试调模型。Key加密存D1，页面只显示是否存在。同厂商换模型可留空保留Key；换厂商需要新Key。启停与清Key不清除历史用量。

“共享使用上限”留空表示只监控，不设调用次数或金额上限。后台保留累计共享调用和输入/输出tokens；累计保守预留是平台参考值，不是服务商扣费。个人Key用量不占共享统计。自填模型单价可留空，未知价格不计算参考金额；如果设置金额预算门禁，则须有明确参考单价。会话/并发及单次材料和输出边界仍执行。

配置revision参与访客默认服务同意和请求。保存或停用后的旧版本请求会被拒绝；已在途推理可能仍被供应商计费，结果不再作为当前配置展示。

## 维护与部署

使用既有 `npm run deploy:standalone` 和 `wrangler.standalone.jsonc`，保持原D1及verified状态。新增schema由 `0002_organizer_admin.sql` 与 `0003_organizer_auth.sql` 建立，不重置pilot_requests。

首次开通工具：`node scripts/provision-organizer.mjs ABSOLUTE_PRIVATE_DIRECTORY`。它只补缺失的 `LIUBAI_ADMIN_PASSWORD_HASH` 和 `LIUBAI_SECRET_KEY`，运行秘密经stdin传Wrangler；不读取或覆盖已有secret值。高熵口令只以SHA256存运行环境，明文及master备份仅在受控本机目录，不输出到终端。已有管理secret但无对应本机资料时工具拒绝重置。

新配置服务不继承旧试用价格日期或固定18次/¥0.90限制；旧无organizer行的兼容路径保留其原策略。服务商价格与真实账单需组织者自行核查。按用户要求本轮跳过全量/旧回归，仅做新权限与配置最小检查、浏览器联通及构建/发布核对。
