# 发言聚焦与本页提示音验证记录

验证日期：2026-09-22  
验证环境：Docker Desktop 29.8.0；Compose 项目 `ui-speech-sol-0922`；Chromium 与 WebKit  
验证范围：v2 发言准备/正式发言聚焦、提示音、原有舞台行动与语音条回归。未部署，未操作 5174 或其他测试栈。

## 覆盖内容

- 发言准备 15 秒倒计时、舞台行动“提前开始发言”直接提交且不增加确认步骤。
- 正式发言、切换发言者、遗言、平票发言的横幅、计时器、座位文字和头像光环。
- 本页提示音默认关闭，只有用户点击后才调用 `AudioContext.resume()`；刷新后恢复关闭。
- 公开昼夜/阶段 2 与本人准备/正式发言变化各响一次；重复快照、断线重连、页面隐藏期间变化及恢复显示不补响。
- Web Audio 解锁失败时保持关闭并降级为文字提醒；不改动语音 `autoMic` 流程。
- 公开观众和私人第二屏可见当前发言者，但不会出现“轮到你了”。
- 320、390、844、1440 像素宽度下无横向溢出，环形桌面与头像光环未遮挡行动区。
- 使用实际位图 URL `/assets/avatar-sheet.png` 验证发言者头像仍由圆形容器裁切，不以光环外溢为代价。

对应自动化：`e2e/specs-v2/22-speech-attention.spec.ts`。

提示音自动化使用可记录 `resume`、振荡器启动次数和状态变化的 Web Audio 桩，验证用户手势解锁、触发次数、去重、隐藏页与失败降级等程序契约。未连接真实声卡或移动设备试听，因此音色、实际响度、不同设备的听感和真实浏览器音频策略不在本次验证结论内。

## 测试发现与修复

初版光环样式直接设置 `.stage-seat--speaking .avatar { overflow: visible }`。默认 SVG 头像截图未暴露问题；换用实际位图 URL 后，严格断言在 Chromium 与 WebKit 均得到 `overflow: visible`（预期 `hidden`），确认上传头像会失去既有圆形裁切。

修复将 `Avatar` 包入 `.seat-avatar-halo` 外层，光环伪元素迁移到外层，头像本体继续使用基础 `.avatar { overflow: hidden; border-radius: 50% }`。相同位图、相同严格断言复验通过；320 与 1440 像素截图也确认头像裁切和外部光环同时保留。

## 实际执行结果

以下命令均通过指定 Docker CLI、Compose 项目 `ui-speech-sol-0922` 执行：

- `npx vitest run tests/frontend-v2-voice-levels.test.ts tests/frontend-v2-voice-session.test.ts tests/frontend-v2-actions.test.ts tests/frontend-v2-stage-layout.test.ts`：4 文件、24 例通过。
- `npm run typecheck:web:v2`：wrapper 修复后复跑通过。
- `npm run typecheck:web:v2-tests`：wrapper 修复后复跑通过。
- `npm run build:web:v2`：wrapper 修复后复跑通过（仅有既有的大 chunk 提示）。
- `npx playwright test --config=playwright.v2.config.ts specs-v2/22-speech-attention.spec.ts specs-v2/18-voice-levels.spec.ts specs-v2/03-actions.spec.ts`：修复后 Chromium/WebKit 共 24 例通过。

中间结果如实记录：第一次新增测试运行有 2 例因 `role=status` 选择器歧义失败，限定到“发言与提醒”区域后 6/6 通过；加入真实位图裁切断言后稳定暴露产品问题（4 通过、2 失败）；产品 CSS 修复后最终 24/24 通过。未运行全量 Vitest 或全量 E2E。

截图输出在 `test-results-frontend-v2/speech-attention-{320,390,844,1440}-{chromium,webkit}.png`，为本地测试产物，不纳入源码交付。
