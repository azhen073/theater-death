# 公开阶段转场独立验证

验证日期：2026-09-22。基线：`upstream/main` `b3f5a1e`。验证者仅新增 E2E 测试和本记录，未修改产品代码。

## 执行环境与结果

- Docker Server 29.8.0；使用唯一 Compose project `sol-ui-phase`，未映射宿主端口，未使用真实本地数据。
- `node scripts/test-incremental.mjs tests/frontend-v2-phase-transition.test.ts tests/frontend-v2-identity-reveal.test.ts tests/frontend-v2-display-model.test.ts`：3 文件、16/16 通过。
- `node scripts/test-incremental.mjs tests/test-selection.test.ts`：1 文件、11/11 通过。
- `npm run typecheck:web:v2`：通过。
- `npm run typecheck:web:v2-tests`：通过。
- `npm run build:web:v2`：通过；仅有既有的大 chunk 提示。
- `npx playwright test --config=playwright.v2.config.ts specs-v2/20-phase-transition.spec.ts specs-v2/19-identity-reveal.spec.ts specs-v2/03-actions.spec.ts specs-v2/08-display.spec.ts`：首次 41/44；其中 `03`、`08`、`19` 双浏览器 32/32 通过。
- 修正测试时序后，`npx playwright test --config=playwright.v2.config.ts specs-v2/20-phase-transition.spec.ts`：Chromium + WebKit 12/12 通过。
- 主复核修正系统 reduce 与用户明确 `full` 的优先级后，同一命令再次双浏览器复跑：12/12 通过；新增断言确认 `full` 可覆盖系统 reduce。
- 截图复跑 `specs-v2/20-phase-transition.spec.ts --project=chromium`：6/6 通过；产物为 `test-results-frontend-v2/phase-transition-1440.png` 与 `phase-transition-390.png`，均已目视检查可读且无横向溢出。
- PR #10 推送后的真实场景复核发现产品缺陷：阶段二通常与公开死讯同批到达，原先“死讯优先即永久消费转场”导致真实阶段二几乎不展示。产品改为内存 pending，按前向兼容的 3.2 秒死亡优先窗口延后，再展示 2.2 秒转场；刷新、离线、后台、紧急行动、其他弹层或减少动画会取消 pending 且不补播。
- 缺陷修复验证：相关单测 3 文件 16/16、两个前端类型检查、生产构建均通过；`20 + 19` Chromium + WebKit 最终 22/22 通过。另定点复跑 pending 刷新/离线用例 2/2 通过。

首次三个失败不是产品缺陷：测试在死讯 DOM 的 1.8 秒视觉结束后立即触发下一阶段，但产品按需求保留 2.2 秒死讯优先窗口；测试改为等待完整窗口。另一个 Chromium 失败源于连续推送观众 scope 与下一阶段被 React 合并，尚未建立观众基线；测试改为在观众 scope 重新加载后再推送实时阶段。

## 覆盖范围

覆盖实时天亮、入夜、第二阶段，2.2 秒 CSS 时长及无延长消失；刷新、离线重连、隐藏页恢复不补播；紧急行动跳过及进行中取消；减少动画；身份入场卡互斥；公开观众；同批公开死讯/放逐先展示、3.2 秒后继续天亮或阶段二；pending 遇紧急行动、刷新或离线立即取消且恢复后不补播；已展示转场遇新死讯立即取消且不重复；公开文案不包含角色 ID、角色名、阵营或私密行动信息。

未运行全量 Vitest 或全量 E2E，未部署，未提交或推送。
