# 剧院死神（Theater Death）

13 人 9 身份的社交推理游戏**在线法官**：服务端持有真实状态并做全部裁决，纯规则引擎 + Socket.IO 实时推送 + 网页前端；支持「玩家电脑 / 第三方服务器」两种托管（同一 Docker 镜像）。

- 玩法权威：`theater_death_rulebook_v1.1.md`（1.1 默认预设，含 S3 裁定与追加记录）；规则 2.0 命名预设见 `docs/rules-v2-full.md`
- 工程规格：`theater_death_development_requirements_v1.1.md`（逐版记录见文末；**当前维护版本以 `PROGRESS.md` 的进度表为准**）
- 进度与交接：`PROGRESS.md`
- 协作规则与测试策略：`AGENTS.md`（改代码前先读：先讲方案后动手、只在容器内跑测试、默认只跑增量、未经明确指令不推远端）
- 版本号约定：**版本名 = 推送分支名**；工程版本与**规则版本**（1.1 / 2.0）、**客户端契约版本**（2.1 / 2.2）是三套独立编号，不互相换算（各版本状态见 `PROGRESS.md`）

## 快速开始（Docker）

宿主机只需 Docker（无需 Node.js）：

```bash
git clone https://github.com/azhen073/theater-death.git
cd theater-death
./deploy/install.sh          # Windows: deploy\install.ps1
```

浏览器打开 `http://localhost:3000` → **注册账号（数字 UID）→ 登录进入大厅 → 创建房间 → 把房间码发给同伴**。部署、公网入口、运维与回滚见 `deploy/RUNBOOK.md`。

- 默认入口为**新版体系**（账号 + 新版界面；规则 2.0 命名预设可用）；如需旧版入口，`.env` 设 `ENTRY=v1` 后重新 `up -d`。
- 语音默认关闭；在 `.env` 配置声网凭据后启用（`AGORA_APP_ID` / `AGORA_APP_CERTIFICATE`；`AGORA_CUSTOMER_KEY` / `AGORA_CUSTOMER_SECRET` 供踢人 / 终局关房 / 频道对账，`AGORA_REST_BASE_URL` 中国区留空即用默认域名）。**注**：本项目实测声网侧「连麦鉴权」未生效（已接受该风险），发布权由服务端签发 / 撤回 + 发布凭证 150 秒 TTL 兜底，详见 `PROGRESS.md`。

## 更新

```bash
git pull
./deploy/update.sh           # 拉取 CI 构建的镜像，约 1-2 分钟；Windows: deploy\update.ps1
```

日常启停见 `deploy/start.sh` / `deploy/stop.sh`（Windows 为 `deploy\start.ps1` / `deploy\stop.ps1`）。

## 开发与测试

全部构筑 / 测试 / 运行都在容器内执行（与宿主机隔离）：

```bash
docker compose -f deploy/docker-compose.yml build   # 构建 = 类型检查 + 全部测试 + 两个前端打包
docker compose -f deploy/docker-compose.yml up -d
```

改代码时不必每次都整包构建——**默认只跑增量测试**（改哪个跑哪个，同样在容器内）：

```bash
docker compose -f deploy/compose.frontend.yml run --rm test node scripts/test-incremental.mjs tests/xxx.test.ts
docker compose -f deploy/compose.frontend-acceptance.yml --profile acceptance run --rm browser npx playwright test --config=playwright.v2.config.ts specs-v2/xxx.spec.ts
```

（E2E 需先 `--profile acceptance up -d api web`，用到账号/时钟夹具时再 `run --rm seed`；全量回归只在明确要求时运行。）

合并进 `main` 后，GitHub Actions 会自动构建（镜像构建内含全部测试）并发布 `ghcr.io/azhen073/theater-death:latest`。

## 贡献

`main` 分支受保护：请从自己的分支发起 Pull Request（至少 1 个批准后合并）。

```bash
git checkout -b feat/your-change
# 改动后先跑相关测试
docker compose -f deploy/docker-compose.yml build   # 完整构建；或仅跑相关单测
git push origin feat/your-change
gh pr create
```

- 玩法规则改动必须先更新规则书条款引用、测试与版本记录
- 客户端只能提交意图，身份由服务端会话解析——不接受信任载荷自报的改动
- 报告真实执行命令与结果；未运行的测试必须标明

## 致谢

- **syhneversigh**（PR #3、#5）：账号体系（数字 UID）、v2 稳定房间模型与租约、新版前端（web-v2）、契约 2.x 与验收测试；舞台行动 UX 与竖屏适配、团队方案「发布并确认本人」原子提交（经维护方复核修复后整合）；开局身份揭示（v2.0.5-alpha）
- **kiahir**（PR #2、#4、#7、#17）：终局退出（需求 v1.5）、全仓库文档一致性核对（需求 v1.9）、房间解散任意阶段生效与遗弃房间 24 小时回收（需求 v2.0.1-beta）、遗言顺序明文与账户「显示与动画」修复（v2.0.2-beta）、局内语音音量显示与调节（v2.0.3-alpha）、声网语音可靠性收口——送达回执 / 频道轮询对账 / 部署面凭据链补齐（v2.0.6-alpha）、竞选投票提示与公屏写权限档位（Q-10）/ 白天自由发言阶段（Q-11）/ 座位徽标与濒死标记 / 进入对局前的大厅与复盘语音（Q-12）（v2.0.7-alpha，进行中）

## 目录结构

| 目录 | 内容 |
| --- | --- |
| `engine/` | 纯规则引擎（状态 + 动作 → 状态 + 事件，无时钟/网络依赖） |
| `visibility/` | 授权投影（先裁剪再发送，复盘视图） |
| `server/` | 入口分发、会话、房间、夜间/白天驱动、HTTP API、Socket.IO 实时 |
| `server/v2/` | 新版体系（账号、稳定房间与租约、契约 2.x、实时与视图） |
| `rulesets/` | 板子配置与验证器（正式 1.1/2.0 命名预设、实验模式） |
| `web/` | 旧版前端（`ENTRY=v1` 回滚时使用） |
| `web-v2/` | 新版前端（React + Vite，同镜像交付，默认入口） |
| `contracts/` | 新版客户端契约类型 |
| `voice/` | 声网 RTC 适配：token 签发、媒体回收与频道管理 REST（踢人 / 关房 / 对账） |
| `docs/` | 契约文档、规则 2.0 增补与前端说明 |
| `tests/` | Vitest 测试（全量口径见 `PROGRESS.md` 的测试状态）+ `fixtures/contract-2.1` 契约快照 |
| `e2e/` | Playwright 端到端验收（`specs/` 旧版、`specs-v2/` 新版） |
| `scripts/` | 构建与测试脚本（`build-frontend-v2.mjs`、`test-incremental.mjs`、`seed-frontend-v2.ts` 等） |
| `deploy/` | Dockerfile、compose、安装/更新脚本、运行手册 |
