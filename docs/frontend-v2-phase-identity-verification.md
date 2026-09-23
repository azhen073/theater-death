# 分阶段身份能力独立验证

验证日期：2026-09-22。基线：`upstream/main` `b3f5a1e`。验证者仅新增 `e2e/specs-v2/23-phase-identity.spec.ts` 与本记录，未修改产品代码。

## Docker 增量结果

使用唯一 Compose project `sol-ui-identity`，复用锁定镜像，不映射宿主端口、不使用真实本地数据。

- `node scripts/test-incremental.mjs tests/frontend-v2-phase-ability.test.ts tests/frontend-v2-identity-reveal.test.ts tests/test-selection.test.ts`：3 文件、27/27 通过。
- `npm run typecheck:web:v2`：通过。
- `npm run typecheck:web:v2-tests`：通过。
- `npm run build:web:v2`：通过；仅有既有的大 chunk 提示。
- `npx playwright test --config=playwright.v2.config.ts specs-v2/23-phase-identity.spec.ts specs-v2/05-information.spec.ts specs-v2/19-identity-reveal.spec.ts`：Chromium + WebKit 26/26 通过。

## 覆盖范围

新 E2E 覆盖全部九身份在一、二阶段的当前摘要、另一阶段说明与 R 条款；公开阶段变化实时更新；公开观众与 subject 错配不出现私人能力面板；私人第二屏明确标为观察视角；死亡、无任务、整局一次能力已用不被描述成当前可用；边界文案明确以服务端舞台任务为准；系统减少动画与 390 像素视口无横向溢出。既有信息隔离与身份入场回归均通过。

这些文字是前端规则摘要，没有修改规则目录或合同。未运行全量 Vitest 或全量 E2E，未部署，未提交或推送。

## 能力面板截图补验

在同一 `23-phase-identity.spec.ts` 中补充二阶段降临者的截图用例，未修改产品代码。聚焦运行 Chromium 与 WebKit 共 2/2 通过，分别在 390 与 1440 像素宽度留存“情报”页能力面板和“我的身份”弹窗，共 8 张：

- `test-results-frontend-v2/phase-identity-intel-descender-stage2-{390,1440}-{chromium,webkit}.png`
- `test-results-frontend-v2/phase-identity-my-role-descender-stage2-{390,1440}-{chromium,webkit}.png`

截图确认当前阶段为第 2 阶段，身份为降临者，摘要明确“不再获得濒死名单”，并保留 R-24 引用。图片是本地测试产物，不纳入源码交付。
