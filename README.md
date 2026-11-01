# 留白

从一件生活小事开始，陪你把话说出来，慢慢理清，再留下自己认可的记录。

当一件事反复盘旋、感受不容易表达，或只是想记住一个舒服的片刻，你可以先写零散的一两句。留白用 AI 具体回应，尝试区分经历、感受、在意与未知；理解不贴切时，可以纠正，也可以随时停下。

[在线试用](https://blank.sakura.observer/clarity) · [AI 设置](https://blank.sakura.observer/clarity?settings=ai) · [组织者后台](https://blank.sakura.observer/admin)

## 当前体验

1. 直接写下想聊的事，点击“开始聊聊”。
2. 按自己的节奏继续说。可以要求只听、不分析或不再追问。
3. 想回看时，点击“整理这次对话”，生成一份可修改的草稿。
4. 核对、修改后，自愿确认保存到当前浏览器，也可以导出图片或文字。

“只保留已有内容”是独立的本地保留动作，不会再请求 AI。“结束本次”可以不生成报告、不保存地结束。

当前重点是日常倾诉与轻量思绪梳理，也保留开心片刻和小选择的表达。本期不含塔罗，复杂决策与长期记忆尚未作为成熟能力交付。

## 当前状态

更新于 **2026-11-01**，处于小范围线上内测。

- 已接通真实 AI 对话、按需整理、修改确认、本机保存及导出；访客访问无需 ChatGPT 登录。
- 正在打磨理解准确性、减少重复与过度推断，以及温和、具体的后续问题。
- 自动化检查、开发者合成案例和单次体验反馈分别记录；尚未完成多人无指导验收，不能据此宣称全部场景质量通过。

本仓库默认分支 `main` 暂保留早期原型代码；**当前开发实现与线上部署来源在 [codex/clarity-tarot](https://github.com/Sakuraivi/blank-space/tree/codex/clarity-tarot)**。该分支名称沿用早期规划，不代表当前体验包含塔罗。获取当前源码请使用下面的克隆命令。

## AI 服务与费用

- 默认选择“留白陪伴”，由组织者配置共享服务；访客无需自行填写 Key。
- 也可在 AI 设置选择个人服务。当前提供 DeepSeek、Kimi、GLM、OpenAI、阿里云百炼，支持服务商目录及自定义模型 ID。
- 个人 Key 的费用由填写者的服务商账户承担，不占组织者共享用量；服务不可用时不会静默切换付费方。
- 组织者在后台用管理口令配置默认服务、Key、模型并查看用量。当前共享次数与预算未设置硬上限，实际调用仍可能计费；费用以服务商账单为准。
- 每次生成注入统一场景规则并校验候选，但字段与来源检查不能保证语义理解正确。模型结果仍由本人核对。

## 数据如何保留

- 发送后，本次表达与相关对话内容会经留白后端交给所选 AI 服务；旧记录不会自动上传。
- 未保存的对话与个人 Key 暂留当前页面，刷新或离开会清除；个人 Key 不写入本机记录或数据库。
- 确认保存后，所选整理和保留的生活原话写入当前浏览器，不含 Key、交流指令或完整问答过程。共用设备的人可能看到本机记录。
- 后端 D1 保存服务配置及调用账本，不保存复盘正文；供应商的正常请求处理仍适用。
- 默认导出整理主文，是否附带原话由本人选择。页面不录音，设备键盘的语音输入由设备处理。

## 本地开发

需要 Node.js **22.13 或以上**、npm。当前主线是独立静态页面与 Cloudflare Worker API。

```powershell
git clone --branch codex/clarity-tarot https://github.com/Sakuraivi/blank-space.git
cd blank-space
npm run install:ci
npm run dev:clarity-listening
```

打开 `http://127.0.0.1:4195/`。本地真实预览仅使用页面内填写的个人 Key，不读取线上共享凭据。模拟模式必须单独启动，并有明显标识；它只验证交互，不代表真实 AI 效果。

## 开发与部署资料

- [当前对话开发指南](https://github.com/Sakuraivi/blank-space/blob/codex/clarity-tarot/README.clarity.md)：真实预览、模拟预览、定向检查与代码入口。
- [Cloudflare 独立部署与迁移边界](https://github.com/Sakuraivi/blank-space/blob/codex/clarity-tarot/STANDALONE.md)：配置、构建、数据库和部署注意事项。
- [当前发布状态](https://github.com/Sakuraivi/blank-space/blob/codex/clarity-tarot/openspec/changes/clarity-tarot-reflection/beta-release.md)：线上版本、回退基线与已知限制。
- [自然接话修复与实测](https://github.com/Sakuraivi/blank-space/blob/codex/clarity-tarot/openspec/changes/clarity-tarot-reflection/natural-companionship-repair.md)：机制修复、真实结果与未通过项。
- [历史 README](https://github.com/Sakuraivi/blank-space/blob/273d1de93d8bee2f5dedb17ac22d87f37450610e/README.md)：早期 Sites 托管、卡片、固定题数及旧测试额度记录，均按当时版本理解。

当前站点由独立 Cloudflare Workers / D1 托管。源码中保留的 Sites / Vinext 工具与旧页面用于历史兼容；当前试用入口是上方的 `/clarity`。
