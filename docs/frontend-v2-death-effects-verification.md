# 公开死亡视觉：实现与验收

日期：2026-09-22。基线 `upstream/main` 的 `b3f5a1e`，独立分支 `feat/public-death-effects`。基线已包含维护方合并的身份提示 PR #8；本批不重提该 PR。

## 实现范围

- 公开死讯触发定位到对应头像的红黑烟雾/碎片，最长 3.2 秒；已死亡头像覆盖静态星芒，回归移除。
- 直接复用现有 `avatar-sheet.png`，通过 viewBox 裁切和 CSS 混合显示参考图中的死亡主效果；图片原件及 SHA-256 不变，没有额外位图依赖。
- 监听移到稳定的房间容器，最后一次公开死亡紧接复盘时仍保留简短公告；新打开复盘不重播。连续不同座位独立到期，不因重复快照延长。
- 私人死亡不泄露；首次/重连/换局/换视角/返回页面建立游标基线；同帧回归以最终公开 alive 状态为准。
- 关闭特效或减少动画仍保留文字状态；粒子层不拦截操作，重新启用不补播旧批次。
- 一个舞台一个 Canvas，碎片总量限制为 100/220（按舞台宽度），DPR ≤2，最长边 ≤4096；只在短时效果期间运行动画，清理 timer/RAF/visibility 监听。

## 本地验收命令

以下命令在仓库根目录运行，全部实际执行于 Docker。验收项目名为 `td-death-fx-20260922`；数据卷与当前本地游戏分离。

```sh
docker compose -p td-death-fx-20260922 -f deploy/compose.frontend.yml run --rm --no-deps test sh -c 'node scripts/test-incremental.mjs tests/frontend-v2-death-effects.test.ts tests/frontend-v2-display-model.test.ts tests/frontend-v2-stage-layout.test.ts tests/frontend-v2-action-presentation.test.ts tests/frontend-v2-actions.test.ts tests/frontend-v2-snapshot.test.ts tests/test-selection.test.ts && npm run typecheck:web:v2 && npm run typecheck:web:v2-tests && npm run build:web:v2'

docker compose -p td-death-fx-20260922 -f deploy/compose.frontend-acceptance.yml --profile acceptance up -d api web
docker compose -p td-death-fx-20260922 -f deploy/compose.frontend-acceptance.yml --profile acceptance run --rm --no-deps -e FRONTEND_REPORT_FILE=/results/death-fx/acceptance-final.json -e FRONTEND_ARTIFACT_DIR=/results/death-fx/acceptance-final-artifacts browser npx playwright test --config=playwright.v2.config.ts 03-actions.spec.ts 05-information.spec.ts 08-display.spec.ts 19-identity-reveal.spec.ts 20-death-effects.spec.ts
```

结果：7 个单测文件 **59/59** 通过；两项前端类型检查及生产前端构建通过；5 个相关 E2E spec 在 Chromium/WebKit 共 **56/56** 通过。构建仍提示既有主包超过 500 kB（包括声网依赖），不是本批新增依赖。

另在本项目独立测试卷执行 `run --rm --no-deps seed`，然后执行同一 acceptance 编排的 `browser npx playwright test --config=playwright.v2.config.ts 09-full-game.spec.ts --project=chromium`：真实 13 人第一局、复盘及第二局启动 **1/1** 通过（14.4 秒）。E2E 增量验收总计 57 项通过。仅使用合成测试账号，没有触碰 `frontend-local` 数据。

新增 E2E 不仅检查 DOM：读取 Canvas 像素确认确有绘制，并比对粒子像素重心与对应头像；操作记录页和玩家详情确认点击穿透。覆盖公开/私人死讯、多人连续批次、回归及再次死亡、减少动画/关闭特效、终局切换、刷新与 scope 边界、320/390/844/1440 宽度和 5/13/26/64 席位、90/100/110% 缩放。

截图与 JSON 结果存于本地忽略目录 `test-results-frontend-v2/death-fx/`。已人工查看桌面与手机截图，确认星芒覆盖头像且文字仍可读。没有把截图或测试账号入库。

首轮新增 E2E 发现首次挂载时父级 ref 尚未附着、粒子层未找到舞台的问题；改为提交后的 effect 查询，双浏览器复验通过。另修正新测试对“记录”标签的精确名称定位（未读标记会加入可访问名称），未改变公屏实现。

本轮未跑全量回归，未升级现有本地游戏镜像、未部署服务器、未合并 PR。这里只声明浏览器/容器验证，不声称已经在实体低端手机测量帧率。
