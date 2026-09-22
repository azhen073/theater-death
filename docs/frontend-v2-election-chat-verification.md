# Web v2 选举名单与公屏验收记录

日期：2026-09-22  
基线：`upstream/main` `b3f5a1e`  
工作树：`worktrees/ui-election-chat`  
测试模型：GPT-5.6-Sol

## 范围

新增 `e2e/specs-v2/24-election-chat.spec.ts`，未修改产品实现。覆盖报名、退选、平票重投、竞选结束及当选结果；名单在公屏/情报/记录/规则四个页签均持续可见；公开观众看到相同公开名单且没有私人信息；夜间和复盘不显示名单。公屏覆盖发送者席位与昵称、底部跟随、阅读历史时保持位置并显示未读、回到最新、分页锚点、跨页签草稿、长昵称/长文本纯文本渲染，以及 320/390/844/1440 无横向溢出。

仓库没有 `e2e/specs-v2/06-chat.spec.ts`；既有聊天回归位于 `05-information.spec.ts`，因此本次运行 05 与新增 24。

## 隔离环境

使用 Docker 29.8.0、唯一 Compose project `ui-election-sol-0922`、依赖镜像 `theater-death-contract-deps:sharp0354-ajv820` 和浏览器镜像 `theater-death-frontend-e2e:pw1630-ts`。Acceptance 只启动 `api` 与 `web`，未运行 seed，未映射或访问宿主真实 5174 服务。

## 命令与结果

以下 `docker.exe` 均指 `C:\Users\xumat\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe`。

```powershell
docker.exe compose -p ui-election-sol-0922 -f deploy/compose.frontend.yml run --rm test node scripts/test-incremental.mjs tests/frontend-v2-chat-tracker.test.ts tests/frontend-v2-room-model.test.ts
```

结果：2 个文件、18 项测试全部通过。

```powershell
docker.exe compose -p ui-election-sol-0922 -f deploy/compose.frontend.yml run --rm test npm run typecheck:web:v2
docker.exe compose -p ui-election-sol-0922 -f deploy/compose.frontend.yml run --rm test npm run typecheck:web:v2-tests
docker.exe compose -p ui-election-sol-0922 -f deploy/compose.frontend.yml run --rm test npm run build:web:v2
```

结果：全部退出码 0；构建转换 102 个模块并验证生产入口，仅有既有的大块产物提示。

```powershell
docker.exe compose -p ui-election-sol-0922 -f deploy/compose.frontend-acceptance.yml --profile acceptance up -d api web
docker.exe compose -p ui-election-sol-0922 -f deploy/compose.frontend-acceptance.yml --profile acceptance run --rm browser npx playwright test --config=playwright.v2.config.ts specs-v2/24-election-chat.spec.ts specs-v2/05-information.spec.ts
```

首轮：18 项中 16 项通过；现有 05 双浏览器 12/12，通过；新增 24 的名单状态、观众隔离与响应式 4/4 通过。两项失败均来自新测试把 Node 侧变量直接闭包进浏览器 `evaluate`，修正为显式参数传递后继续验证。第二轮发现分页按钮被 Playwright 自动滚入视口会改变点击前位置基准；这同样是测试测量顺序问题，而非产品跳动。修正为先显式滚入分页按钮、再记录锚点并点击。

```powershell
docker.exe compose -p ui-election-sol-0922 -f deploy/compose.frontend-acceptance.yml --profile acceptance run --rm browser npx playwright test --config=playwright.v2.config.ts specs-v2/24-election-chat.spec.ts
```

最终：新增 24 在 Chromium + WebKit 6/6 通过。未发现产品缺陷。

## 截图

- `test-results-frontend-v2/election-chat-chromium.png`
- `test-results-frontend-v2/election-chat-webkit.png`

两张截图均在循环最终 1440×900 视口拍摄并人工检查：名单层级清楚，退选删除线、参选状态与席位号可辨；长昵称在名单和座位卡内收束，超长连续聊天文本在公屏内换行，没有横向撑破页面。

## 未执行项

未运行全量 Vitest、全量 v2 E2E 或 v1 E2E；未做真实多人连接、真实语音或服务端部署；未提交、未推送、未部署。
