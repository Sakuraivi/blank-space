## Why

留白的公开体验页没有可发现的 Key 入口，现有管理页又依赖站点所有者的 ChatGPT 登录，阻碍了亲友试用。用户希望访客可填自己的 Key，留空时使用组织者默认 Key，并希望页面从清淡的展示页变成温暖、有生活感的表达空间。

## What Changes

- **BREAKING**：公开 AI 体验不再要求 ChatGPT 登录或体验码；`/admin.html` 改为面向当前访客的 AI 设置入口，不承担全站配置写入。
- 增加个人 DeepSeek Key 优先、留空使用组织者默认 Key 的选择规则；个人 Key 仅在当前页面内存和单次服务端请求中使用，默认 Key 通过托管秘密配置提供。
- 所有凭据路径继续使用同一服务端场景规则、来源与候选校验和本轮 18 次持久调用上限；个人 Key 无效时不静默改用默认 Key。
- 首页、记录流程与设置页采用原创生活场景插画、暖色层次和逐步叙事，保留三种场景、可选卡片、纠正、编辑确认、本机保存和导出。
- 保留旧受保护管理 API 兼容已有配置；不把全站默认 Key 读写权开放给匿名访客。

## Capabilities

### New Capabilities

- `public-ai-settings`：公开个人 Key 配置、默认凭据选择、无登录 AI 体验、凭据数据边界与统一预算。
- `warm-reflection-experience`：温暖的首页与连续记录体验、公开设置入口、响应式和无障碍基础行为。

### Modified Capabilities

无。当前 `openspec/specs/` 尚无已归档主规格；本变更承接未归档的 `ai-api-pilot`，明确替代其访客必须使用体验码的规则。

## Impact

- 前端：`public/app.mjs`、`public/index.html`、`public/style.css`、`public/admin.*` 与原创 SVG 资产。
- 服务端：`server/api.mjs` 的状态、凭据选择和生成入口，以及对应测试；复用 `ai/` 的规则、适配器与 D1 账本。
- 运行配置：新增服务端秘密 `LIUBAI_DEFAULT_DEEPSEEK_KEY`；不更换站点 ID、域名、访问受众或数据库。
- 交付：记录调研借鉴、离线验收与真实模型尚未验证的限制，完成构建后沿用现有 Sites 发布流程。
