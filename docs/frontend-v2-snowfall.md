# Web v2 二阶段全局飘雪

日期：2026-10-02（v2.0.8-alpha，贡献 kiahir）

## 范围与口径

对局内**二阶段**叠加整页飘雪，纯前端装饰层：只读公开状态（房间相位 / 轮次 / 昼夜 / 阶段），
不读私有任务、行动进度或任何身份信息，不改规则（2.0）、不改客户端契约（2.2）、不碰服务端与引擎。

判定口径（`web-v2/src/presentation/snowfall.ts` 的 `snowActive`）：

```text
view.room.phase === 'playing' && view.gameId && view.public
  && view.public.phase !== 'ended' && view.public.stage === 2
```

- 二阶段的白天与夜晚都飘雪；大厅、复盘、一阶段、离场一律不出现。
- 观战与第二屏同显（只读公开 `stage`，不含隐藏信息），与夜间舞台氛围同口径。
- 与夜景氛围（`night-atmosphere`，舞台内层）互不冲突，二阶段夜间两者叠加——E2E 有共存断言。
- 与死亡粒子（Canvas，座位层）无关；`--stage-brightness` 按既有约定只作用舞台布景，不作用于飘雪。

按用户 2026-10-02 裁定：**整页/视口全局**、**DOM + CSS 动画**、**不加独立开关**、
**减少动画时完全不显示**、形态**极简**（单个雪粒面积小、密度低）。

## 形态与预算

| 项目 | 取值 | 说明 |
| --- | --- | --- |
| 直径 | 3–6px | 圆点，无贴图、无旋转动画 |
| 不透明度 | .12–.34 | 只做氛围，不承载信息（2026-10-02 用户追加「透明度适当降低」） |
| 下落时长 | 11–20s | linear 循环，每片独立 |
| 横向 | 摆动 ±9px、偏移 ±13px | 缓速左右飘，不做闪烁 |
| 数量 | `clamp(round(area/13000), 45, 150)`，≤680px 再 ×0.6 | 1440×900 约 100 粒；320×720 取 45 粒下限 |

尺寸与密度按用户 2026-10-02 两次追加裁定（「可适当增大尺寸和密度」→「增加雪粒的密度和大小」）相对首版
（1.4–2.6px / 18–48 粒）逐级放大，仍属极简：不贴图、不旋转、不闪烁。

随机值来自固定种子的线性同余发生器（`makeSnowflakes(seed, count)`），种子由
`snowSeed(view)`＝`gameId|roomId|dayNumber` 派生：同一局同一天的推送、刷新、重连不会重排既有画面，
换天或换局才换一组。每片雪花的 `delay` 取 `-random × duration`，**首帧即已铺满整屏**，不会「先空后满」。

## 实现

| 文件 | 作用 |
| --- | --- |
| `web-v2/src/presentation/snowfall.ts` | 纯函数：`snowActive` / `snowflakeCount` / `snowSeed` / `makeSnowflakes` |
| `web-v2/src/features/game/snowfall-layer.tsx` | 组件：接线偏好与可见性，测量图层高度，生成 CSS 变量 |
| `web-v2/src/styles/snowfall.css` | 固定层、`@keyframes snow-fall`、昼夜配色、减少动画兜底 |
| `web-v2/src/features/game/scene.tsx` | 在 `.game-scene` 内挂载 `<SnowfallLayer view active={active && online}/>` |

形态与层级：

- `position: fixed; inset: 0; z-index: 4; overflow: hidden; pointer-events: none`：盖住舞台与页面底色，
  但始终在 sticky HUD(5) / 语音条(8) / 死亡公告(20) **之下**，不遮挡工具行与公告；
  弹窗是 `<dialog>` 顶层，雪花不会盖住身份卡、复盘与显示设置。
- 每片雪花是一个 `<i>`，只做 `transform` 动画（`snow-fall`：起于 `-12px`，50% 处取摆动值，终到图层高度）；
  JS 不跑 rAF 常驻循环，只在挂载/窗口尺寸变化时测一次图层本地高度。
  落点距离由 JS 写入 `--snow-fall` / `--snow-mid`，在任何显示缩放（根元素 `zoom`）与环形/网格布局下都自洽。
- 昼夜两套配色：夜间 `#eaf3ff` + 淡蓝光晕；白天改用近白冷调芯 `#eef4fc` + 白色外缘，
  避免白点淹没在纸张底色里。颜色不承载信息，纯装饰。

无障碍与性能：

- 「动画偏好 = 减少动画」（或系统 `prefers-reduced-motion`）→ 组件返回 `null`，整层卸载（不留静态雪）。
- 标签页隐藏 → 卸载停止全部动画；恢复可见回来（环境动效允许回来，与夜景氛围的一次性雾效刻意不同）。
- 离线（`active && online` 为假）或离场时同样卸载；雪花层 `aria-hidden`，不改 Tab 顺序与点击命中。

## 与既有偏好/设置的边界

- **不加独立开关**：沿用账户「显示与动画」的「动画偏好」，避免扩大偏好键集合
  （`localStorage['theater-death-display-v1']` 仍是原来的 10 个字段，`08-display.spec.ts` 的键集合断言不变）。
- 不读 `stageBrightness` / `deathEffects` / `voice*` / `attentionSound` 任何一项。

## 验证

### 单测（容器内）

`tests/frontend-v2-snowfall.test.ts`（8 例）：判定真值表（一阶段 / 二阶段昼夜 / 大厅 / 复盘 / 终局 /
缺公共视图 / 缺对局 / 观战）、数量上下界与单调性、非法尺寸归零、同种子确定性、极简形态取值域
（尺寸 3–6px、不透明度 ≤.34、延迟 ≤0 且 ≥−duration、漂移/摆动上界、全为有限数）、零/负/非有限数量。

结果：`docker compose -p snow-1002 -f deploy/compose.frontend.yml run --rm test node scripts/test-incremental.mjs tests/frontend-v2-snowfall.test.ts` → **1 文件 8 例全过**。

### 类型检查与打包（容器内）

`npm run typecheck:web:v2`、`npm run typecheck:web:v2-tests`、`npm run build:web:v2`。

结果：三项均退出码 0（同一 compose test 容器）；`build:web:v2` 转换 125 个模块，仅有既有的单块大于 500 kB 提示。

### 端到端

`e2e/specs-v2/36-snowfall.spec.ts`（4 例）覆盖：一阶段无雪 → 二阶段出现且为极简形态（片数区间、
`animation-name`、尺寸/不透明度上界）；图层中心与屏幕上可见雪粒的命中测试都不落在 `.snowfall`，
且真实座位点击仍然生效；减少动画立即卸载、恢复标准动画后回来；页面隐藏卸载、返回后回来；
大厅与复盘不出现；二阶段夜间与夜景氛围共存；320 / 390 / 844 / 1440 四档无横向溢出并留截图。

结果：`docker compose -p snow-1002-acc -f deploy/compose.frontend-acceptance.yml --profile acceptance run --rm browser npx playwright test --config=playwright.v2.config.ts specs-v2/36-snowfall.spec.ts` → **chromium + webkit 8/8 通过**（首轮 6/8：失败原因是规格自身在复盘相位仍断言「玩家舞台」——复盘页渲染的是复盘视图，已改为 `pushFixture` 切相位后断言雪花层消失，非产品缺陷）。
截图：白天二阶段 `test-results-frontend-v2/snowfall-chromium.png`、`snowfall-webkit.png`；夜间二阶段（清空私有任务以露出环形舞台，便于同时看夜景氛围与飘雪）`test-results-frontend-v2/snowfall-night-chromium.png`、`snowfall-night-webkit.png`；另用一次性像素探针（同屏冻结动画、开关雪花层各截一张做差）确认雪粒确实绘制在预期坐标上（图层 1440×900，粒心像素差 18–65），探针文件已删除。

## 未做 / 未覆盖

- 未跑全量 Vitest / 全量 v2 E2E / v1 E2E（按项目规则，默认只跑增量）。
- 未做真实物理雪花密度主观验收；未对超窄（<320px，非支持档）单独调参。
- v1 入口（`ENTRY=v1`）不实现该特效，属已知不对称。
