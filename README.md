# 剧院死神（Theater Death）

13 人 9 身份的社交推理游戏**在线法官**：服务端持有真实状态并做全部裁决，纯规则引擎 + Socket.IO 实时推送 + 网页前端；支持「玩家电脑 / 第三方服务器」两种托管（同一 Docker 镜像）。

- 玩法权威：`theater_death_rulebook_v1.1.md`（含 S3 裁定与追加记录）
- 工程规格：`theater_death_development_requirements_v1.1.md`
- 进度与交接：`PROGRESS.md`

## 快速开始（Docker）

宿主机只需 Docker（无需 Node.js）：

```bash
git clone https://github.com/azhen073/theater-death.git
cd theater-death
./deploy/install.sh          # Windows: deploy\install.ps1
```

浏览器打开 `http://localhost:3000` → **注册账号（数字 UID）→ 登录进入大厅 → 创建房间 → 把房间码发给同伴**。部署、公网入口、运维与回滚见 `deploy/RUNBOOK.md`。

- 默认入口为**新版体系**（账号 + 新版界面；规则 2.0 命名预设可用）；如需旧版入口，`.env` 设 `ENTRY=v1` 后重新 `up -d`。
- 语音默认关闭；在 `.env` 配置声网凭据（`AGORA_*`）并在声网控制台开启「连麦鉴权」后启用。

## 更新

```bash
git pull
./deploy/update.sh           # 拉取 CI 构建的镜像，约 1-2 分钟
```

## 开发与测试

全部构筑 / 测试 / 运行都在容器内执行（与宿主机隔离）：

```bash
docker compose -f deploy/docker-compose.yml build   # 构建 = 类型检查 + 全部测试 + 两个前端打包
docker compose -f deploy/docker-compose.yml up -d
```

推送代码到 `main` 后，GitHub Actions 会自动构建（镜像构建内含全部测试）并发布 `ghcr.io/azhen073/theater-death:latest`。

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

- **syhneversigh**：贡献账号体系（数字 UID）、v2 稳定房间模型与租约、新版前端（web-v2）、契约 2.x 与验收测试等（PR #3，已按采用/调整说明整合进 `main`）

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
| `docs/` | 契约文档、规则 2.0 增补与前端说明 |
| `tests/` | Vitest 全量测试（520 用例）+ `fixtures/contract-2.1` 契约快照 |
| `e2e/` | Playwright 端到端验收（`specs/` 旧版、`specs-v2/` 新版） |
| `deploy/` | Dockerfile、compose、安装/更新脚本、运行手册 |
