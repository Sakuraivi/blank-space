## Purpose

让组织者在已验证的独立后台自行更换管理口令，避免操作运行环境或公开登录资料。改密必须保持明确的凭据权威、并发提交和会话撤销边界，同时保护现有共享Key、加密主密钥及历史用量。

## ADDED Requirements

### Requirement: 已认证的同源改密入口
系统 SHALL 提供 `POST /api/organizer/password`，接受 `{currentPassword,newPassword,confirmPassword}`。请求 MUST 经过现有安全会话验证、精确同源及有限JSON输入校验，并在执行高成本口令验证前通过持久原子限速。未认证者返回401 `auth_required`，当前口令错误返回401 `current_password_invalid`，限速返回429 `rate_limited`；响应不得包含明文口令、校验值或内部异常。

#### Scenario: 未认证或跨站访问
- **WHEN** 未认证请求、伪造平台身份或跨站请求尝试改密
- **THEN** 请求被拒绝，不修改凭据、会话或共享配置；跨站沿用403 `origin_rejected`

#### Scenario: 当前口令错误或限速
- **WHEN** 已登录组织者提交错误当前口令，或超出持久尝试上限
- **THEN** 分别返回 `current_password_invalid` 或 `rate_limited`，凭据不变，当前有效会话不因这两种错误被主动撤销

### Requirement: 新口令的原样输入与明确错误
新口令 MUST 为有效Unicode字符串，包含15–128个Unicode码点且UTF-8编码不超过512字节；不得trim、规范化或截断。确认口令 MUST 与新口令完全一致，且新口令必须不同于本次已验证的当前口令。合法当前口令不受新口令最短长度规则追溯限制。

#### Scenario: 格式、确认或重复错误
- **WHEN** 当前口令正确，但新口令不合长度或编码约束、确认不一致或沿用当前口令
- **THEN** 分别返回400 `invalid_password`、`password_mismatch` 或 `password_unchanged`，不修改凭据

#### Scenario: 中文及空格按原样使用
- **WHEN** 组织者提交包含中文或空格的合法新口令
- **THEN** 精确输入可用于后续登录，自动去空格或改写后的不同字符串不能替代该口令

### Requirement: 持久凭据覆盖具有唯一权威
系统 SHALL 持久保存带盐、受限高成本派生校验值及凭据版本，禁止保存明文新口令。迁移 MUST 建立明确的bootstrap种子状态；只有该状态可使用原Cloudflare bootstrap凭据。覆盖状态生效后，旧bootstrap口令不得作为第二条验证或找回路径，缺失、损坏或无法读取凭据状态时 MUST 返回503 `service_unavailable`并拒绝认证。

#### Scenario: 新凭据替代bootstrap
- **WHEN** 首次改密成功且D1覆盖状态有效
- **THEN** 新口令可登录，旧bootstrap口令不能登录；新凭据验证不依赖原bootstrap secret或额外pepper

#### Scenario: 凭据状态缺失或损坏
- **WHEN** 迁移后的单例行缺失、KDF参数损坏或数据库读取失败
- **THEN** 认证及改密失败关闭，不尝试旧bootstrap口令，不根据客户端参数降低KDF强度

### Requirement: 并发改密与登录有版本边界
改密 MUST 绑定当前口令验证所依据的持久凭据revision进行原子比较后提交；冲突返回409 `credentials_conflict`。登录在高成本验证后签发会话时 MUST 再以所验证的凭据状态为条件，不能凭早先读到的旧口令状态签发有效新会话。

#### Scenario: 两个并发改密请求
- **WHEN** 两个请求依据同一凭据版本完成当前口令验证并提交不同新口令
- **THEN** 至多一个提交成功，另一个返回 `credentials_conflict`，不能覆盖胜者凭据或删除胜者后续会话

#### Scenario: 慢旧口令登录遇到改密
- **WHEN** 旧口令登录验证尚在执行时新凭据已提交
- **THEN** 该旧验证不能继续签发有效会话，并返回受控冲突结果

### Requirement: 新epoch提交立即使旧会话失效
改密成功 MUST 提交独立随机的新epoch，使所有旧管理会话后续验证失效，并返回200 `{changed:true,authenticated:false}`及清除当前Cookie。新epoch的持久提交是失效真相，旧会话物理清理失败不得回滚凭据、恢复旧会话或误报改密未提交；延迟清理不得删除之后签发的新epoch会话。

#### Scenario: 清理失败但新凭据已提交
- **WHEN** 新epoch已成功提交，但删除旧会话失败
- **THEN** 改密仍按成功处理，旧会话不能认证，用户需使用新口令重新登录

#### Scenario: 延迟清理与更新会话并发
- **WHEN** 较早改密请求的清理延迟执行，而较新凭据下已经签发会话
- **THEN** 清理只能影响较早请求所见的旧epoch，不能误删更新会话

### Requirement: 后台敏感输入与会话体验
后台 SHALL 提供当前、新、确认三个口令字段及取消操作，改密与其他后台写操作使用同一互斥busy边界。提交完成、取消、收起或离页 MUST 清空口令字段及未保存Key草稿，不回填、持久化或记录口令明文。成功后进入登录入口并提示使用新口令，说明本机首次登录资料不会自动更新。

#### Scenario: 当前口令错误不退出后台
- **WHEN** 后台收到401 `current_password_invalid`
- **THEN** 在改密区域说明错误并清理敏感输入，保留当前有效后台会话；不能按 `auth_required` 统一踢回登录

#### Scenario: 成功与取消清理
- **WHEN** 改密成功，或用户取消、收起、离开页面
- **THEN** 口令及未保存Key草稿被清空，成功时回到登录且所有旧会话失效

### Requirement: 隔离共享配置及最小发布验证
改密 MUST 不修改共享AES主密钥、API Key、模型配置或历史账本。验收 SHALL 仅运行新增的认证/API检查、本地模拟链路及必要构建/部署核对，跳过旧回归和全量测试。生产验证 MUST 只检查schema、匿名守卫、静态资源与只读状态，不代用户提交新口令或调用真实模型。

#### Scenario: 用户自主完成生产改密
- **WHEN** 新功能发布到既有独立Worker/D1
- **THEN** 由用户在后台亲自输入新口令，交付报告明确本地模拟及生产只读的验证范围，共享配置和历史用量保持不变
