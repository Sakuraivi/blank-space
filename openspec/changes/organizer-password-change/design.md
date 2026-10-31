## Context

动机见proposal。仓库现有独立认证使用高熵bootstrap口令的Cloudflare SHA256 secret、D1 opaque会话及由bootstrap hash派生的epoch；管理API已有同源JSON、有限body、持久登录限速和Secure/HttpOnly/SameSite严格Cookie。共享Key使用独立的 `LIUBAI_SECRET_KEY` 加密。

目标工作树为 `liubai-warm-companion-copy`，基于管理后台版本及已提交温馨文案；主代理正并行实现新凭据迁移与后台输入，规划仅写本变更目录。主spec目录尚无已归档认证能力，新增delta承载本轮契约。

## Goals / Non-Goals

**Goals:** 统一权威凭据解析、有限成本KDF、版本提交、全旧会话撤销及用户自主改密链路，保持共享配置独立。

**Non-Goals:** 不提供注册、未认证找回、多管理员、自动更新本机登录文件、CF secret改写或AES主密钥轮换；不执行旧/全量回归，不在线替用户更改口令。

## Decisions

1. **显式状态代替“查不到即bootstrap”。** 新增 `organizer_credentials` 单例表，迁移种入 `id=main, algorithm=bootstrap, revision=0`，其他凭据材料为空。首次改密以CAS更新为 `pbkdf2-sha256-v1`；缺表、缺行、不支持的algorithm或损坏参数统一失败关闭。所有login/session/password路径共用异步解析，不保留仅查看CF secret的认证捷径。bootstrap模式沿用原epoch计算以兼容既有有效会话；覆盖模式完全使用D1凭据，不再试CF旧口令，也不依赖pepper。相比“覆盖行不存在就回退”，明确状态可防止误删行复活bootstrap。

2. **固定原生KDF参数。** PBKDF2-HMAC-SHA256使用100000迭代，随机盐与输出各32字节；记录algorithm、salt、verifier、revision、随机32字节epoch及更新时间。读取时严格校验编码、长度、安全整数及固定迭代值，客户端不得指定KDF参数。原生Web Crypto异常直接失败，不能降级快速hash。Cloudflare生产曾限制单次PBKDF2至100k，本地workerd可不同，采用已知限制内参数；不把Node/本地通过作为生产推理或改密验证。[官方运行时讨论](https://github.com/cloudflare/workerd/issues/1346)。不引入新的口令库或跨请求旧凭据缓存。

3. **重验证及原子提交。** 新 `POST /api/organizer/password` 先复用同源、有限JSON和有效会话边界；使用独立 `change-password:main`、绑定当前epoch的持久15分钟/10次尝试桶，在KDF前原子占位，不随IP变化绕过。验证当前口令后检查新口令有效Unicode、15–128码点、UTF-8≤512B、确认一致及不同；不trim或规范化。CAS的条件包含当前algorithm/revision/epoch，更新新盐、verifier、revision+1及随机epoch。并发失败不能覆盖胜者，返回409。

4. **会话权威围绕持久epoch。** 会话读取将当前凭据条件放入查询；KDF后的login使用带凭据条件的会话 `INSERT ... SELECT ... WHERE EXISTS`，判断实际写入行数，防止旧验证在改密后发有效会话。改密CAS成功即返回200并清Cookie；可尽力删除**本次改密读到的旧epoch**，但删除不是撤销权威。不得 `DELETE ALL` 或以 `auth_epoch <> 本次新epoch` 清理，否则较早请求延迟执行时可能删掉随后再次改密产生的更新会话。清理失败不回滚、不复活、不将已提交改密误报为未成功。保证后续认证拒绝旧会话，不声称撤回已经执行的外部操作。

5. **固定API结果及前端错误归属。** 200成功 `{changed:true,authenticated:false}`并清Cookie；401 `current_password_invalid`在改密区域显示且不退出，401 `auth_required`进入登录；400 `invalid_password`/`password_mismatch`/`password_unchanged`；409 `credentials_conflict`需重新验证；429 `rate_limited`沿用Retry-After；数据库/KDF/凭据损坏返回503 `service_unavailable`。公共同源失败沿用403 `origin_rejected`，不支持方法405。任何结果不回显三个口令或内部credential材料。后台三字段与共享Key使用统一busy/草稿清理；提交完成、取消、收起、离页清空。成功说明旧会话失效且电脑上的首次登录资料不会自动更新。

6. **共享身份与模型凭据分离。** 新口令只改变管理认证，不派生或变更 `LIUBAI_SECRET_KEY`；不重加密/删除共享Key，不修改organizer_config或pilot_requests，不清零历史。原bootstrap secret保留为首次模式输入，覆盖后的失忆恢复不靠隐式回退；此轮不增加找回入口。

## Risks / Trade-offs

- 100k受运行环境约束且用户自选口令可能弱于原随机口令 → 执行长度、随机盐、固定KDF及KDF前限速，明确该约束，不声称达到更高迭代建议。
- CAS已提交后网络断开或清理失败 → 以持久新epoch为准，正常成功回复清Cookie；用户可用新口令重新登录，不回滚到旧口令。
- 本机首次登录文件保存旧bootstrap值 → 页面和维护说明标明旧资料不会自动更新，不将私有登录资料放入源码、日志或公开产物。
- 回滚到只识别bootstrap的旧代码会绕过D1覆盖 → 一旦用户改密，回滚只能选择识别新凭据表的版本或修复前进；不删除/重种凭据行，不恢复旧认证快照。
- 跳过旧/全量回归 → 仅报告新增认证/API、本地模拟、语法/构建及生产只读核对的真实范围。

## Migration Plan

1. 完成新凭据迁移、认证/API与前端，新增focused检查覆盖并发、旧密码、损坏状态、KDF边界及清理失败；使用内存认证/API及合成口令完成登录—改密—新口令登录，本地页面核对登录入口、字段、取消及空输入校验，保留原文案改动。成功改密不要求在真实站点或通过真实后台UI代用户执行。
2. 向既有D1应用种子迁移，核对仅新增凭据表/行、共享配置和账本基线未变，再部署同一Worker及域名；不读取或覆盖运行secret，不提交真实口令。
3. 生产仅核对schema、未认证/跨站守卫、静态资源和已授权只读状态；不触发真实改密或模型调用。由用户亲自填写当前与新口令完成生产变更。
4. 如需回滚，保留D1和共享历史；已有覆盖凭据后采用凭据感知版本，防止旧bootstrap重新获得登录能力。
