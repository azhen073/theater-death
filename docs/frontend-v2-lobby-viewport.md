# 房间大厅视口适配修复

2026-09-22；独立基线 `main` `b3f5a1e`，不依赖任何未合并 UI PR。

## 问题与改动

大厅沿用 `.home-main` 的1280px上限和6%横向内边距，较大视口下内容并不会相应展开；根节点的90%/110%显示缩放还会直接缩放 `100svh`，令短内容的页面外壳不足或超过视口高度。

- `AuthenticatedShell` 仅为当前可见的房间大厅添加 `home-layout--lobby`，不影响账户页、首页、规则弹窗或复盘的阅读宽度。
- 大厅取消内容宽度上限，横向留白改为 `clamp(20px, 3vw, 64px)`，避免百分比留白持续增大。
- 已登录页面外壳的最小高度按 `100svh / --display-scale` 补偿，缩放的是字号与内容，不再把应覆盖的视口高度一并缩小/放大。内容较多时仍正常滚动。
- 不读取显示器英寸、`screen.width`、屏幕坐标或固定DPR，不缓存初始窗口尺寸；由CSS对当前浏览器布局视口重排。窗口跨显示器或停在两屏之间时，不需要选择某一块显示器作为布局基准。

没有修改玩法、房间状态、会话/接管规则、服务端或之前的 UI PR。

## Docker 增量验证

独立临时项目 `lobby-fit-0922`，不映射真实服务端口，使用一次性账号和数据卷。

- 修复前运行新增26（Chromium）能复现宽度不匹配，断言失败；修复后相同布局要求通过。
- `node scripts/test-incremental.mjs tests/frontend-v2-display-model.test.ts tests/frontend-v2-room-model.test.ts tests/frontend-v2-stage-layout.test.ts`：3文件20/20。
- `npm run typecheck:web:v2`、`npm run typecheck:web:v2-tests`、`npm run build:web:v2`：通过；构建只有既有大chunk提示。
- Playwright `03-actions` + `08-display`：Chromium/WebKit 26/26，含原软键盘、对局布局、行动和显示设置回归。
- 新增 `26-lobby-viewport`：Chromium/WebKit 2/2。真实登录、建房、进入大厅；90%/100%/110%各按1366→2560→1920→1800→3840→900→680→390→320→1366宽度连续切换；检查填满可用宽度、实际横向滚动、短内容满高不越界、房间码保持不变。
- Chromium通过CDP在同一窗口模拟DPR 1→1.25→1.5→2→1.25→1，验证不受物理像素比例误导。WebKit覆盖连续视口及用户显示缩放，不宣称做了动态DPR模拟。
- 检查账户页仍为1280px上限、规则弹窗不超过560px，准备/解散仍可操作。2560×1440截图位于本地 `test-results-frontend-v2/lobby-wide-{chromium,webkit}.png`。

测试开发中纠正了两个测量问题：`display:block` 时残留的grid-template属性不能代表当前布局；根节点 `scrollWidth` 的特殊缩放单位不能简单乘zoom后与innerWidth比较，改为直接探测实际横向滚动。失败重跑的残留房间需要既有接管流程，最终使用全新临时测试数据复验，没有修改或绕过产品授权。

未跑全量回归，未部署。模拟测试不等同于真实Windows混合DPI双屏拖动，物理显示器/浏览器原生窗口管理行为仍需用户实机确认。
