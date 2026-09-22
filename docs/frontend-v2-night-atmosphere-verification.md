# Web v2 夜间氛围验收记录

日期：2026-09-22  
基线：`upstream/main` `b3f5a1e`  
工作树：`worktrees/ui-night-atmosphere`  
测试模型：GPT-5.6-Sol

## 范围

本次只验收夜间舞台氛围及其与既有行动 UI 的兼容性。新增
`e2e/specs-v2/21-night-atmosphere.spec.ts`，未修改产品实现，未提交、推送或部署。

覆盖银蓝静态背景、原剧院素材、暗角与光晕、夜初 5 秒雾效和 24 个粒子、同夜刷新与重连不重播、白天/离场清除、页面隐藏停止、页面显示设置切换“减少动画”立即停止且保留静态背景、座位与行动卡可读可点，以及 320/390/844/1440 宽度无横向溢出。

## 环境与隔离

Docker：`C:\Users\xumat\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe`，服务端版本 `29.8.0`。使用唯一 Compose project `ui-night-sol-0922`，依赖镜像 `theater-death-contract-deps:sharp0354-ajv820`，浏览器镜像 `theater-death-frontend-e2e:pw1630-ts`。Acceptance 仅启动 `api` 与 `web`，未运行 `seed`，没有映射或访问宿主真实 5174 数据服务。结束后执行 `down -v` 清理本次容器、网络和临时卷。

## 命令与结果

以下命令均在该工作树内运行，省略的 Docker 可执行文件前缀均为上文绝对路径。

```powershell
docker.exe info --format '{{.ServerVersion}}'
```

结果：成功，`29.8.0`。

```powershell
docker.exe compose -p ui-night-sol-0922 -f deploy/compose.frontend.yml run --rm test node scripts/test-incremental.mjs tests/frontend-v2-stage-layout.test.ts tests/frontend-v2-display-model.test.ts tests/frontend-v2-actions.test.ts tests/frontend-v2-action-presentation.test.ts
```

结果：4 个文件、33 项测试全部通过。

```powershell
docker.exe compose -p ui-night-sol-0922 -f deploy/compose.frontend.yml run --rm test npm run typecheck:web:v2
docker.exe compose -p ui-night-sol-0922 -f deploy/compose.frontend.yml run --rm test npm run typecheck:web:v2-tests
docker.exe compose -p ui-night-sol-0922 -f deploy/compose.frontend.yml run --rm test npm run build:web:v2
```

结果：三项均退出码 0。构建转换 102 个模块并验证生产入口；仅有既有的单块大于 500 kB 提示。

```powershell
docker.exe compose -p ui-night-sol-0922 -f deploy/compose.frontend-acceptance.yml --profile acceptance up -d api web
docker.exe compose -p ui-night-sol-0922 -f deploy/compose.frontend-acceptance.yml --profile acceptance run --rm browser npx playwright test --config=playwright.v2.config.ts specs-v2/21-night-atmosphere.spec.ts specs-v2/03-actions.spec.ts
```

首轮结果：20 项中 16 项通过；`03-actions` 双浏览器 14/14 通过，夜景视觉/响应式 2/2 通过。4 项失败来自新规格自身的两个错误假设：引用了不存在的 `lobby-full.json`；以及在同一个已挂载页面里改变 Playwright media 后，测试立即假定所有消费偏好的组件已按新的初始化状态重建。前者改为从日间夹具明确构造大厅状态；后者不再用 reload 规避，而改为通过真实“显示设置 → 动画偏好”交互验证运行时变化。

`usePreferences` 确实监听 `matchMedia('(prefers-reduced-motion: reduce)')` 的 `change` 事件，因此系统偏好运行时切换属于产品支持范围。首轮失败并不能证明产品有缺陷：该步骤把“减少动画”初态和后续“新夜应播放”串在同一用例中，并在恢复 media 后直接推进夹具，混入了 session 去重键与 Provider 同步时序。修正版直接操作用户可见设置，先观察 24 粒子存在，再选择“减少动画”，确认根节点状态变为 `true`、运动 DOM 立即卸载而静态光晕/暗角保留；随后恢复标准动画并进入新夜，再验证隐藏/返回行为。这条路径不依赖 reload，也真实覆盖了运行时取消动画。

```powershell
docker.exe compose -p ui-night-sol-0922 -f deploy/compose.frontend.yml run --rm test npm run typecheck:web:v2-tests
docker.exe compose -p ui-night-sol-0922 -f deploy/compose.frontend-acceptance.yml --profile acceptance run --rm browser npx playwright test --config=playwright.v2.config.ts specs-v2/21-night-atmosphere.spec.ts
```

最终结果：类型检查退出码 0；页面设置版夜景规格 Chromium + WebKit 6/6 通过，其中两种浏览器都验证了从 24 个运动粒子到选择“减少动画”后运动 DOM 立即卸载、静态层继续存在。

## 截图与人工检查

- `test-results-frontend-v2/night-atmosphere-chromium.png`
- `test-results-frontend-v2/night-atmosphere-webkit.png`

两张截图均人工检查：原剧院背景结构仍清楚可见，银蓝色调、中央冷光和四周暗角有实际视觉差异；座位卡、选中态、行动卡标题、倒计时、说明及提交按钮保持清晰。Chromium 与 WebKit 截图都在规格循环的最终 1440×900 视口拍摄；规格在每个项目内都顺序验证了 320、390、844、1440 四档宽度，不能把项目默认视口当作截图视口。

## 结论与未执行项

### 2026-09-22 独立亮度 PR 兼容增量

夜景背景改为通过可选CSS变量 `--stage-scenery` 提供；仅检测到独立背景层时让该层承载背景，氛围自身读取 `--stage-brightness`（缺省1）。没有亮度PR也保持原夜景，不导入亮度组件或账户设置，仍可独立合并。

隔离项目 `night-independent`：display-model/stage-layout单测10/10、两个前端typecheck与build通过；`21-night-atmosphere` + `03-actions` Chromium/WebKit 20/20。原预览资源、短时动画及操作可读性保持不变。

未发现夜间氛围产品缺陷。未运行全量 Vitest、全量 v2 E2E 或 v1 E2E；未使用真实多人房间或真实语音；未提交、未推送、未部署。
