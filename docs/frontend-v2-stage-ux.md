# web-v2 舞台行动交互与响应式布局规格

本文档记录 PR A 阶段关于局内行动交互收拢与响应式布局的已定案工程规格。

## 1. 核心交互原则

1. **舞台全收拢**：所有 18 种行动任务、目标选择、参数调整、一次性最终提交、即时反馈与网络未决恢复全部在舞台（Stage）内部完成。
2. **废除旧外壳**：移除舞台下方独立行动面板（`.action-dock`）与屏幕底部固定行动条（`.mobile-action-bar`），消除双重提交入口。
3. **单次最终确认**：合法意图仅确认一次；无目标动作点击即确认；空守/弃票/跳过由明确的独立按钮触发，清空草稿仅重置本地选择不发请求。
4. **公屏零改动**：电脑右侧公屏位置、300px/280px 宽度规则、四标签（公屏/情报/记录/规则）与聊天发送及历史滚动行为严格保持现状。

## 2. 纯展示推导层（Presentation Layer）

- 模块：`web-v2/src/features/actions/presentation.ts`
- 纯函数 `deriveActionPresentation` 接收 `view`、`task`、`draft`、`records`、`online`、`remainingMs`，输出结构化的 `ActionPresentation`。
- 状态集合：`editing`、`sending`、`accepted`、`changed`、`rejected`、`recovering`、`expired`、`offline`、`idle`。
- 状态隔离：按 `actionScopeKey(view)`（房间、局号、玩家视角、只读状态）隔离草稿与恢复记录，防止跨视角泄漏。

## 3. 响应式布局与断点

采用“一份组件、一份草稿、一份座位 DOM”的设计，支持桌面、平板、横屏手机与竖屏手机：

1. **宽屏环形模式**（`>1180px` 且座位数 `<=13` 且空间充足）：
   - `StageActionCard` 居于舞台中央保留区（`position: absolute; left: 20%; right: 20%; top: 50%; transform: translateY(-50%);`），严防遮挡座位；
   - 座位沿外环以绝对坐标排布。
2. **非环形模式**（大人数、窄屏、手机端）：
   - 团队方案、指定发言顺序与只读观察采用正常文档流，避免较高内容遮挡环形座位和次数加减工具；
   - 统一采用“**行动卡在舞台顶部正常文档流，完整座位网格紧随其后**”；
   - `681px–1180px`：`.stage-seats--ring` 与 `.stage-seats--grid` 统一使用 4 列网格（`repeat(4, minmax(0, 1fr))`），清除环形座位的绝对定位和固定高度；
   - `<=680px`（包含 390×844 竖屏手机）：统一使用 3 列网格（`repeat(3, minmax(0, 1fr))`）；
   - 移动端行动卡优先使用自然文档流，页面自然纵向滚动，软键盘呼出时不遮挡公屏输入框与发送按钮。
