# theater_death 当前进度与交接

## 当前版本

- 工程：`v2.0.8-alpha`
- 规则：`2.0`
- 客户端契约：`2.2`
- 上游基线：`azhen073/theater-death` 的 `main` / `1a8ae6c`
- 当前产品只提供 v2 入口；本地清理已移除 v1 回滚源码、旧前端和旧测试。

本文件只记录当前状态，不保存逐版本合并史或历史测试计数。验证以当次实际命令输出为准。

## 当前能力

- 账号注册登录、数字 UID、头像和管理后台。
- 稳定房间、准备与开局、房主管理、观战和私人第二屏。
- 完整昼夜规则、团队方案、竞选与放逐、遗言、胜负和复盘。
- 公屏权限档位、白天自由发言、大厅与复盘语音。
- 声网语音授权、发布凭证续期、送达回执和频道对账。
- 开局身份揭示、阶段身份说明、座位徽标、濒死标记和降临者查验徽标。
- 昼夜转场、死亡特效、暗色主题、舞台亮度、移动端布局和二阶段飘雪。

## 当前结构

```text
engine/             纯规则引擎
visibility/         授权视图和复盘
rulesets/           规则 2.0 预设与验证
contracts/          契约 2.2 类型
server/             共享房间、命令、驱动和日志
server/v2/          账号、稳定房间、API、实时与媒体
web-v2/             现行 React 前端
voice/              声网适配
tests/              Vitest 与契约 2.2 夹具
e2e/specs-v2/       当前浏览器验收
deploy/             构建、部署和运行手册
docs/               当前规则、契约、前端和素材文档
```

## 常用命令

```bash
# 标准构建：类型检查 + 全部保留的 Vitest + web-v2 打包
docker compose -f deploy/docker-compose.yml build

# 启动
 docker compose -f deploy/docker-compose.yml up -d

# 增量单元测试
 docker compose -f deploy/compose.frontend.yml run --rm test node scripts/test-incremental.mjs tests/xxx.test.ts

# v2 浏览器验收
 docker compose -f deploy/compose.frontend-acceptance.yml --profile acceptance up -d api web
 docker compose -f deploy/compose.frontend-acceptance.yml --profile acceptance run --rm browser npx playwright test --config=playwright.v2.config.ts specs-v2/xxx.spec.ts
```

## 交接注意事项

- 默认规则文档是 `docs/rules-v2-full.md`，需求文档是 `theater_death_development_requirements.md`。
- 契约夹具位于 `tests/fixtures/contract-2.2/`。
- 运行数据仍保留在 `data-v2/`；清理源码不代表删除账号、审计或对局数据。
- 语音真实媒体验收需要有效声网凭据，不能用文字模式代替。
- 全量 E2E 只在明确要求时运行；历史失败和历史通过计数不作为当前验证结论。
- 本地保留 `feat/ui-night-depth` 作为未合并功能分支；其内容不属于上游 `v2.0.8-alpha`。
