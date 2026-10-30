## Context

见proposal。v6中主题点击只选mode；AI同意提交会调用start重建记录，设置对任意session锁定。改为主题先创建session后，必须将设置窗口与推理会话区分，避免直接搬按钮导致原文丢失。服务端与D1无需变化。

## Goals / Non-Goals

**Goals:** 唯一的三主题入口、主题相关开头、完整虚构预览、同记录的首次story方式选择。

**Non-Goals:** 第四主题、后台协议/预算/模型变更、自动推理、真实Key评测、保存预览、重新设计整套视觉。

## Decisions

1. 三卡使用动词标题且直接start指定mode，去除aria-pressed及勾选。压缩hero高度使入口更早出现，保留暖色插画。相比保留通用开始按钮，单一入口结构更清楚。
2. 静态内容模块提供三主题和各三条开头、placeholder及成品示例，app负责转义和渲染。预览用与成品相近的信纸样式，退出只关闭弹窗并聚焦主题区。
3. ai.setupLocked初始false，首次有效story提交置true，此后不因返回、失败或本地回退而解除。仅初始story可选择方式；已同意AI时配置锁定，切local清AI工作副本而保留session/story及本页设置偏好。相比重建session，同记录更新避免输入和主题丢失。
4. 新增无正文/凭据的设置窗口gate：ticket绑定generation/sessionId/modeId，开始新选择、取消、导航、离页均使旧ticket失效；input revision不影响窗口。普通设置另用modal generation及状态快照保护异步读取。
5. local初始story允许配置Key，apply可通过新的ticket继续AI同意；同意submit先验证ticket及真实route再关闭弹窗、更新aiState，不调用start。取消仍是local故事。首次有效提交后设置/方式锁定，模型调用时机不变。
6. 复用现有四家、发送同意、Key内存、pagehide/BFcache、候选与迟到回复保护。只为新增状态协议写有意义的测试；内容、布局和按钮行为通过浏览器覆盖。

## Risks / Trade-offs

- [异步状态读取复活旧弹窗] → ticket及modal generation同时检查，独立于输入revision。
- [方式重选清空故事或session] → 同记录赋aiState，验收故事保留、主题不变且设置阶段无生成。
- [用户返回修改时意外换付费方] → setupLocked单向锁定；已同意AI先切local才可换Key，提交后不能重开设置窗口。
- [成品示例被当作真实效果保证] → 明确虚构与可选步骤，不保存、不调用模型。

## Migration Plan

无数据库和环境迁移。先本地纯状态回归与三主题/AI mock/390浏览器验收，再全量回归、构建、发布既有公开站点。旧页面刷新后使用新入口，个人Key仍仅当前页面有效。
