# 舞台背景与账户亮度

## 当前行为

- “我的账户 → 显示与动画”提供舞台背景亮度设置，范围 50%–130%，默认 100%，可恢复默认。
- 局内不额外出示亮度滑杆。
- 偏好保存在浏览器本地显示设置中，刷新、跨标签页和房间沿用；不跨设备同步。
- 缺失或非法旧值回退默认，有限数值取整并钳制范围。

亮度滤镜只作用于独立 `.stage-backdrop` 布景层。头像、文字、座位状态、行动区和公屏不进入滤镜。`--stage-scenery` 可覆盖布景背景，昼夜和主题样式共享同一亮度变量。

相关实现位于 `web-v2/src/features/game/`、`web-v2/src/features/account/` 和 `web-v2/src/styles/`。相关测试包括 `frontend-v2-display-model`、`frontend-v2-stage-layout` 与 `e2e/specs-v2/25-stage-brightness.spec.ts`。
