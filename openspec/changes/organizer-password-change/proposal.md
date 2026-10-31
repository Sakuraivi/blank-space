## Why

组织者已有独立后台，但修改管理口令仍需操作运行环境。用户希望在已登录后台自行更换口令，同时让旧口令和所有旧管理会话失效，并保留现有共享服务配置与历史用量。

## What Changes

- 新增已认证、同源的 `POST /api/organizer/password`，校验当前口令、新口令及确认口令。
- 新口令按输入原样处理，限定15–128个Unicode码点、最多512个UTF-8字节，确认须一致且不能与当前口令相同。
- 增加D1显式bootstrap凭据种子及盐化PBKDF2覆盖；覆盖后旧Cloudflare bootstrap口令不再参与验证，缺行或损坏拒绝认证。
- 凭据revision做CAS，随机epoch在提交时撤销旧会话；登录的会话插入也绑定所验证的凭据状态，防止并发改密后签发旧会话。
- 后台增加三个口令字段及成功后重新登录链路；提交、取消、收起或离页清理敏感草稿，操作互斥。
- 仅新增该功能的认证/API检查和本地模拟链路；生产只核对schema、匿名守卫、资源及只读状态，由用户亲自输入新口令。

## Capabilities

### New Capabilities

- `organizer-password-management`：后台改密、权威凭据状态、KDF与并发边界、全会话撤销及最小验收。

### Modified Capabilities

无已归档同名能力。该变更扩展活动变更 `organizer-admin` 的独立认证，不改变共享模型、AES主密钥或账本规则。

## Impact

涉及 `server/organizer-auth.mjs`、`server/organizer-api.mjs`、后台三个静态文件、管理说明及新的凭据表迁移。复用Web Crypto和既有D1，无新增密码库。只向既有Worker/D1发布；不自动更新本机登录文件或将私有登录资料纳入源码/日志，不替用户在线改密，不变更共享API Key、加密主密钥、历史额度或模型调用策略，也不触发真实模型调用。
