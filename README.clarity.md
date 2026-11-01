# 留白当前对话开发指南

当前主线为 `clarity-v3`，线上入口是 [blank.sakura.observer/clarity](https://blank.sakura.observer/clarity)。它已连接真实模型；默认首页保留既有页面，主线开发无需改动旧入口。

本文件替代旧的 `clarity-v2` / 4192 开发说明。旧说明可在 [历史版本](https://github.com/Sakuraivi/blank-space/blob/273d1de93d8bee2f5dedb17ac22d87f37450610e/README.clarity.md) 中查看，原固定题数、测试预算与发布状态不再作为当前规则。

## 获取当前代码

仓库默认分支 `main` 暂保留早期原型。当前开发源码在 `codex/clarity-tarot`，名称是历史标识，本期不含塔罗。

```powershell
git clone --branch codex/clarity-tarot https://github.com/Sakuraivi/blank-space.git
cd blank-space
npm run install:ci
```

需要 Node.js 22.13 或以上。若已克隆仓库，请先处理自己的未提交改动，再切换并同步该开发分支。

## 真实 AI 预览

```powershell
npm run dev:clarity-listening
```

默认监听 `http://127.0.0.1:4195/`。在页面的“AI 设置”中填写临时个人 Key 并确认；这会使用真实服务商 API，可能产生费用。Key 不要发到聊天或提交进 Git。

本地服务器仅监听本机，使用内存数据库；不读取线上共享 Key、默认服务或额度，管理接口也不连接线上后台。未保存对话和 Key 随刷新清除，本机已确认的记录保留在该端口对应的浏览器存储中。代码修改后需重启服务并使用新页面，保留有草稿的旧标签页。

## 模拟交互预览

如需与真实预览并行，使用另一个端口：

```powershell
$env:LIUBAI_PREVIEW_PORT = "4196"
npm run dev:clarity-listening:fixture
```

打开 `http://127.0.0.1:4196/`。页面会标明“模拟回复 / 未调用真实AI”，数据在独立内存环境中，不连接真实模型。它适合检查状态、按钮与保存，不能用来判断理解深度或陪伴感。环境变量仅控制当前终端启动的端口。

## 有针对性的检查

```powershell
npm run test:clarity-listening
node --test server/clarity-api.test.mjs
npm run test:standalone
npm run build:standalone
```

分别覆盖当前主线、旧 flow 的关键兼容、独立 Worker 边界和本地打包。`build:standalone` 是 Wrangler dry-run，不部署站点，不创建云资源，也不调用模型。文档更新无需运行真实模型或全量回归。

## 主要代码入口

| 文件 | 责任 |
| --- | --- |
| [public/clarity-v3.html](public/clarity-v3.html)、[public/clarity-v3-app.mjs](public/clarity-v3-app.mjs) | 当前单列对话、设置、整理与记录操作 |
| [public/clarity-v3-intent.mjs](public/clarity-v3-intent.mjs) | 默认轻量理解、显式倾听/禁问、整理与停止要求 |
| [public/clarity-v3-contract.mjs](public/clarity-v3-contract.mjs) | 有界输入、七字段候选、来源与阶段校验 |
| [public/clarity-v3-state.mjs](public/clarity-v3-state.mjs) | 请求绑定、上一轮回复观察、修改保护与本机记录 |
| [ai/clarity-v3.mjs](ai/clarity-v3.mjs) | 场景规则、模型请求与候选复核 |
| [ai/providers.mjs](ai/providers.mjs)、[ai/provider-transport.mjs](ai/provider-transport.mjs) | 服务商目录、模型路由与传输 |
| [server/api.mjs](server/api.mjs) | 生成接口、配置核对、用量与幂等 |
| [server/standalone-worker.mjs](server/standalone-worker.mjs) | 线上路由、独立托管及 API 分发 |

## 行为与数据边界

自然表达可得到有依据、可修正的理解，无需输入固定触发词。明确只想说说、不分析或不再追问时，偏好持续生效。没有问题、没有新认识或不保存都可以正常结束；不根据固定轮数自动结案。

“整理这次对话”触发一次真实 review；“只保留已有内容”是本地动作。保存、编辑、回看、导出与结束不新增模型请求，失败由本人手动重试。

上一轮 AI 回复只作为低信任的接话观察，不是本人事实、可引用材料或权限；来源被修改后失效，也不写入保存记录。模型候选不自动成为本人认可的内容。

输入窗口、完整请求字节、并发、超时及记录容量仍有边界；这些与共享费用上限分开。超容量保留原话并提示，不静默截断或假保存。

## 部署与当前质量

部署入口为 `wrangler.standalone.jsonc`，流程见 [STANDALONE.md](STANDALONE.md)。仓库配置绑定现有生产资源，fork 或新环境需配置自己的账户、域名、数据库与凭据；不要直接复用生产标识、修改迁移状态或执行部署命令。

当前工程机制已运行，真实样例仍出现措辞失真、未确认归因与过度推断。定向检查与单次正向体验各自有价值，但不等于全部场景或多人体验已验收。当前证据以 [发布状态](openspec/changes/clarity-tarot-reflection/beta-release.md) 与 [自然接话实测](openspec/changes/clarity-tarot-reflection/natural-companionship-repair.md) 为准。
