## Context

独立Worker剥离平台身份并拒绝旧/api/admin；现有配置仅支持环境默认或旧DeepSeek密文，/admin重定向个人设置。使用隔离worktree，样式侧聊只交接app的pngExport和CSS的letter标签差异。动机见proposal，跳过回归来自用户明确要求。

## Goals / Non-Goals

**Goals:** 独立管理口令、有限安全会话、五家共享Key/模型、可计价自填模型、CAS与在途版本边界，联合样式发布。

**Non-Goals:** 不实现多管理员、密码找回、OAuth、自动付费探测、预算重置、供应商任意地址或全量回归。

## Decisions

1. 高熵随机口令只以SHA256存Cloudflare secret `LIUBAI_ADMIN_PASSWORD_HASH`。D1存256bit opaque会话的hash及由口令hash派生的auth_epoch，绝对8小时；Cookie `__Host-liubai_admin`，Path=/，HttpOnly、Secure、SameSite=Strict，无Domain。口令轮换令旧epoch失效。登录同IP10次/15min原子计数，不做易被DoS的全局锁；同源Origin+JSON写约束，无CORS授权。
2. 新 `organizer_config` 行一旦存在即权威，disabled/密文/模型损坏时不借用旧环境或legacy付款方。只有从未配置才沿用旧路径。AES-GCM复用现有加密函数与 `LIUBAI_SECRET_KEY`；主密钥在Secrets，实际API Key仅密文入库。
3. 独立共享路由签发 `getOrganizerRoute`，旧 `getRoute` 四家保持；百炼Qwen3.8 Flash参考输入0.8/输出2.7元每百万tokens。按用户最新要求，config.callLimit/budgetCny为null表示不限，默认只监控，原历史累计保留。自填单价可均null未知，此时不能设置金额上限，route记录organizer-unpriced及0预留，不声称费用0；次数上限仍可设置。已知费率算保守reserve至少50000微元，不再锁900000，受safe integer检查。createLedger按服务端配置的可选上限原子判断，只有legacy且无organizer配置时保持原默认兼容。[价格依据](https://help.aliyun.com/zh/model-studio/qwen3-8-flash)。
4. 配置revision进入共享priceVersion/幂等digest。公开defaultProfile增加defaultRevision，访客默认同意、请求及响应route带同revision；个人路径不带。默认请求先读source再匹配body，预留前、出站前和完成后检查source；停用或revision变动丢弃旧候选。
5. 新schema加入organizer_config、organizer_sessions与organizer_login_limits，不改pilot_requests。先应用schema、确认secret名字后安全创建缺失的管理hash/加密master，再发布；不读取/覆盖已有运行秘密。
6. 生成口令及加密master由本地脚本通过stdin给Wrangler secrets，原值不输出、不进Git。管理员登录资料保存在仓库外私有目录；生产只验证登录/只读状态/退出，不填假共享Key或启用真实调用。

## API and Service Contract

所有API为同源、no-store JSON，无原始Key/密文/session token；写入必须Origin精确匹配，Sec-Fetch-Site不能cross-site。错误使用 `{reason}` 固定enum，不带内部异常。所有时间为毫秒。

- POST `/api/organizer/login` `{password}` → `{authenticated:true,expiresAt}` + Set-Cookie；错误401 invalid_password、429 rate_limited、503 admin_unconfigured/service_unavailable。
- GET `/api/organizer/session` → `{authenticated:boolean,expiresAt?}`；POST `/api/organizer/logout` `{}` → `{authenticated:false}`并撤销当前会话。
- GET `/api/organizer/status` → 下述status；POST `/api/organizer/config` 保存；POST `/api/organizer/enabled` `{expectedRevision,enabled}`；DELETE `/api/organizer/config` `{expectedRevision}` 清Key并停用。
- 保护端点401 auth_required；同源失败403 origin_rejected；输入400 invalid_config/invalid_key/invalid_pricing；CAS失败409 config_conflict；不支持方法405 method_not_allowed；未迁移/维护503 service_unavailable/maintenance。

status格式：
```json
{"catalog":[{"id":"deepseek","label":"DeepSeek","defaultModelId":"deepseek-flash","allowCustomModels":true,"models":[{"id":"deepseek-flash","label":"DeepSeek Flash","inputRate":2,"outputRate":8,"reserveCny":0.05}]}],"config":{"revision":0,"providerId":"deepseek","modelId":"deepseek-flash","pricingMode":"catalog","inputRate":2,"outputRate":8,"enabled":false,"hasKey":false,"updatedAt":null,"callLimit":null,"budgetCny":null},"budget":{"usedCalls":2,"sharedPromptTokens":0,"sharedCompletionTokens":0,"reservedCny":0.1,"remainingCalls":null,"remainingBudgetCny":null,"totalCalls":null,"budgetCny":null,"currency":"CNY"},"availability":{"enabled":false,"reason":"not_configured"},"limits":{"sessionCalls":5,"concurrentCalls":2,"priceValidUntil":null}}
```

保存body：`{expectedRevision,providerId,modelId,pricingMode:'catalog'|'manual',inputRate,outputRate,apiKey:'',enabled,callLimit:null,budgetCny:null}`。catalog可忽略输入费率并取服务端目录；manual费率可均null未知；提供时必须有限非负，若budgetCny非null则必须已知费率。同厂商可空Key保留、即使换模型；换厂商必须新Key。成功 `{saved:true,revision}`；开关 `{saved:true,revision}`；清Key `{deleted:true,revision}`。保存不试调模型。

`server/organizer-config.mjs`由配置owner实现并向管理API导出：
- `getOrganizerStatus(env,{now=Date.now}={})` → status JSON。
- `saveOrganizerConfig(env,body,{now=Date.now}={})`、`setOrganizerEnabled(env,body,{now=Date.now}={})`、`clearOrganizerKey(env,body,{now=Date.now}={})` → `{ok:true,status:200,body:{...}}` 或 `{ok:false,status,body:{reason}}`，数据库/crypto失败可throw给API统一503。
- `resolveOrganizerSource(env,{now=Date.now}={})` → `{present:boolean,source:null|{type:'organizer',revision,route,encrypted_key,iv}}`，disabled返回present true/source null；服务端内部对象不能序列化到客户端。

`getOrganizerStatus`由配置owner整合catalog、createLedger统计、公开config和availability；认证owner只负责HTTP验证、cookie与调用上述service。配置owner写0002 migration的organizer_config，root以独立0003迁移追加认证两表DDL。前端owner只改admin三文件与ai-settings normalization；root负责app defaultRevision传递及public管理链接、已交接样式、provision脚本和发布。

## Risks / Trade-offs

- 管理口令丢失无自助找回 → 本机私有登录资料交付，后续可在用户Cloudflare轮换secret；不加入未认证的首次抢注或重置入口。
- 自填价格是owner参考值而非账单硬上限 → 后台明确保守预留含义，按固定token界限计算；价格未知仅监控，不允许设置无法估算的金额上限；历史累计不清零。
- 跳过全量回归 → 只声明新功能链路检查与构建通过，保留这一验证限制，不捏造旧测试通过数。
- 并行工作与发布 → 已获侧聊联合发布授权，仅移入确认的两个样式差异；其他提示词不混入。
