# 独立 Cloudflare 托管

此入口与原 Sites/Vinext 构建并存：`npm run build` 及 Sites helper 保持原流程；独立部署直接复用 `public/`、`server/api.mjs` 和 `drizzle/`，不复制生成的 bundle 或前端进源码。

用户已授权在账户 `1420888f16c72742e6bde4cd995d156f` 建立候选及完成核验后切换域名。已建立 Worker `liubai-blank` 与 D1 `liubai-blank-db`（`6bc9e1c5-eac1-4c07-ba26-69b920f89ceb`）；实际发布、数据迁移和域名状态以 [QA.md](QA.md) 的发布记录为准。配置不包含 Key、令牌或其他运行时秘密。

## 本地构建与边界检查

```powershell
npm run test:standalone
npm run build:standalone
```

构建是 Wrangler dry-run，只把当前入口及其导入打包到被忽略的 `dist/standalone/`。不会部署、创建云资源、改 DNS 或执行模型推理。测试覆盖旧管理端点拒绝、伪造身份剥离、pending/缺库/空账本拒绝、静态流程可用及验证后 API 分发。

## 唯一部署入口

```powershell
npm run deploy:standalone
```

此命令只使用 `wrangler.standalone.jsonc`，重新打包当前源码；不要再部署 `work/` 内旧候选 bundle。新建或替换数据库的候选阶段应设 `LIUBAI_DATA_MIGRATION_STATE=pending`，不绑定正式域名路由。pending 保留静态页面，但在任何 API 分发前返回未就绪，不能拿空库开启新试用额度。

只有旧 Sites 已维护冻结、新旧在途请求归零、历史业务表全列快照导入、逐表行数/规范化摘要及共享统计一致，并验证匿名接口、伪造身份和管理拒绝后，才能将生产配置中的迁移状态改为 `verified`，再以同一部署入口激活：

```powershell
npm run deploy:standalone
```

`verified` 不能只因首页返回 200 就设置。迁移核验完成后，将 `verified` 持久化在生产 `wrangler.standalone.jsonc`，域名切换完成后同步正式route，确保后续普通部署保留已确认的生产状态。将来若新建、替换或恢复数据库，必须先改回 `pending`、暂停生成并重新完成数据核验，不能把旧库的验证状态沿用到新库。运行时另有历史最低账本保护（至少两条共享请求与 100000 微元预留），但它不能替代全列迁移一致性核验。保留实际冻结基线，不能恢复初始18次/¥0.90；个人来源仍不占共享额度。不读取、打印或测试真实 Key，不升级付费。

## 离线快照核验

从冻结源与导入目标分别导出同一结构的 JSON：顶层为 `pilot_requests`、`pilot_config` 两个数组，保留每行所有列，包括空值。导出、导入和联网查询由迁移流程单独执行；以下命令只读取指定的两个本地文件，不连接数据库或服务商。

```powershell
npm run test:migration
npm run verify:migration -- work/migration-private/source.json work/migration-private/target.json
```

真实快照含会话标识、加密配置及历史用量，必须放在仓库内已被 `.gitignore` 排除的 `work/migration-private/` 或仓库外受控位置；不要将快照、SQL导出、真实行内容或环境秘密纳入 Git、QA 或截图。只有合成测试样本属于源码。提交前可用 `git check-ignore work/migration-private/source.json work/migration-private/target.json` 确认隔离规则；不要用 `git add -f` 绕过规则。

核验器检查两表完整列集合、唯一主键、值类型和共享历史下限，按主键排列后比较逐表行数与 SHA-256、共享请求/预留总额及余量。正常输出仅为摘要和统计，失败输出固定错误代码；不打印行标识、密文字段或快照片段。单看共享剩余16次/¥0.80不能证明内容一致；必须保留 `matched: true` 的摘要证据，再完成匿名接口、在途归零和其他迁移验收。核验器不会自动导入、修改迁移状态或激活服务。

正式 `blank.sakura.observer` 的绑定是迁移最后一步，执行前旧 Sites 保持冻结。绑定完成后把已确认的路由写入部署配置，并在未来部署时维持该库的已验证状态；不要用旧候选配置覆盖已开放的正式服务。回退前先冻结候选、排空、合并并核验增量账本与配置差异，禁止双端同时生成或直接恢复旧快照。

独立入口拒绝旧 `/api/admin` 和 Sites OAuth 路径，并移除外部 `oai-*`、`x-openai-user-*` 身份头；这些头不构成自管环境的公网认证。当前不另开管理入口。去除 `chatgpt.site` 依赖不保证所有网络可达，原受阻测试者成功访问页面、静态资源及状态 API 后才可报告该次拦截修复。
