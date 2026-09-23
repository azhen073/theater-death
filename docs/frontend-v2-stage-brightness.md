# 独立日间背景与账户亮度设置

2026-09-22。分支 `feat/account-stage-brightness` 直接基于 `main` 的 `b3f5a1e`，不包含夜景 PR #13 或其他未合并 PR 的提交。

## 范围与存储

- 减弱日间浅色遮罩，保留原剧院建筑、地面细节。
- 仅“我的账户 → 显示与动画”提供50%–130%背景亮度滑杆，默认100%，可恢复默认。局内不新增浮窗、按钮或滑杆。
- 沿用 `theater-death-display-v1` 浏览器本地显示偏好，刷新、跨标签页和所有房间沿用；与现有显示偏好一致，当前浏览器跨账号共用，不跨设备同步。
- 只对独立 `.stage-backdrop` 背景层使用亮度滤镜；头像、文字、行动区和公屏不进入该层。
- 旧设置缺少字段时默认100%，非法值回退，有限数字取整并钳制范围。

## 独立性与兼容

生产代码不导入夜景组件，不添加夜景素材，也不改夜景专属文件。`--stage-scenery` 是可选的CSS背景覆盖点；没有其他PR时，main原有日夜背景均可运行。

夜景 PR #13 在自己的样式中提供可选覆盖，并独立处理氛围层亮度。两者无提交依赖、不要求合并顺序；旧原型 `41b456f` 保留，仅作为历史，不纳入此PR。

## Docker 增量验证

独立 Compose project `brightness-independent`，临时账号/数据卷，无实际服务端口映射。

- `node scripts/test-incremental.mjs tests/frontend-v2-display-model.test.ts tests/frontend-v2-stage-layout.test.ts`：11/11。
- `npm run typecheck:web:v2`、`npm run typecheck:web:v2-tests`、`npm run build:web:v2`：通过，只有既有大chunk提示。
- `npx playwright test --config=playwright.v2.config.ts 25-stage-brightness.spec.ts 08-display.spec.ts 03-actions.spec.ts`：Chromium/WebKit 28/28。
- 验证账户真实登录/滑杆、刷新恢复、跨标签同步、不同房间、日夜背景、范围端点与重置、目标点击、局内不出现滑杆及390/1440截图。

未运行全量测试，未部署；生产服务和数据未改动。

### 与 #13 的组合验收

`6bc4fd9` 与夜景兼容提交 `6bf6adb` 在本地测试分支无冲突合并，未推送测试分支。隔离项目 `brightness-night-combo`：相同两文件单测11/11、两个typecheck与build通过；`25-stage-brightness` + `21-night-atmosphere` + `03-actions` 最终双浏览器22/22通过。截图确认日夜背景及座位/行动可读性；组合用例检查背景与夜景装饰同时响应亮度，而行动卡无滤镜。

首轮组合21/22：WebKit既有03的旧窗口目标选择出现一次“预期1/2、实际0/2”断言失败。未改产品或测试断言，该用例连续5次复测通过，随后完整相关组合22/22通过；尚未确定此次偶发失败的根因，不将其表述为已修复的产品缺陷。
