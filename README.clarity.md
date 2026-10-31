# 留白核心对话开发版

入口是 `public/clarity.html`。本地开发服务器把 `/` 映射到这个入口；线上首页仍使用原来的 `index.html`，本轮没有部署。

```powershell
npm run dev:clarity          # http://localhost:4192/，在 AI 设置填临时个人 Key
npm run dev:clarity-fixture  # http://localhost:4193/，标注为固定合成样例
npm run test:clarity         # 仅新版定向检查，不是旧版全量回归
```

开发服务器仅监听本机，数据库在内存中，不读取线上共享 Key 或线上额度。真实模式允许个人 Key 按所选厂商路由调用；Key 只在页面内存中使用，刷新需要重填。网页确认后的整理保存到当前浏览器；开发端口与线上域名的数据不共用。

`node scripts/clarity-preview.mjs --replay-c01` 会在 4193 回放已经存档的真实模型响应，页面有明显说明，无外部模型调用。需按 `ai/evaluations/2026-10-31-c01.json` 前四次请求中的合成文字输入，第三次包含“不是失落，是生气”。它用于验证合并与显示，不用于证明当前模型质量。

主要边界：

- `public/clarity-contract.mjs`：共享输入/候选校验；证据只能引用用户材料；模型不能生成 app ID、确认状态或自定义网络目标。
- `public/clarity-state.mjs`：应用持有修订、等待状态、合并、编辑保护、保存。模型输出不会自动成为已确认内容。
- `ai/clarity.mjs`：场景指令；原多服务商传输与计费模块仍负责路由、凭证和调用记账。
- `server/api.mjs`：显式 `flow: clarity-v2`；缺少 flow 仍用旧契约，非法 flow 在预留额度前拒绝。
- 保存、修改、恢复、回看、导出不触发模型。失败由用户主动重试，不自动补发。

真实样本、成本、发现的问题、暂未完成的质量门槛见 [实现复核](openspec/changes/clarity-tarot-reflection/implementation-review.md)。

发布前仍要完成其他场景、最小输出容量、收尾规则的完整真实复测及无指导用户体验。旧前端的写入器只认识 V1，不能让旧首页和 V2 首页长期并行写同一个 storage key；正式切换和回退必须解决这个兼容边界。
