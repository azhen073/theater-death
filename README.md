# 剧院死神（Theater Death）

13 人、9 身份的社交推理游戏在线法官。服务端持有真实状态并完成全部裁决，使用纯规则引擎、Socket.IO 实时推送和 React 网页前端。同一 Docker 镜像支持玩家电脑和第三方服务器托管。

- 工程版本：`v2.0.8-alpha`
- 规则版本：`2.0`
- 客户端契约：`2.2`
- 规则文档：`docs/rules-v2-full.md`
- 工程需求：`theater_death_development_requirements.md`
- 当前进度与交接：`PROGRESS.md`
- 协作和测试规则：`AGENTS.md`

三套版本号独立，不互相换算。功能版本名沿用推送分支名。

## 快速开始

宿主机只需 Docker，无需安装 Node.js：

```bash
git clone https://github.com/azhen073/theater-death.git
cd theater-death
./deploy/install.sh          # Windows: deploy\install.ps1
```

浏览器打开 `http://localhost:3000`，注册账号并登录，创建房间后把房间码发给同伴。部署、公网入口、运维与回滚见 `deploy/RUNBOOK.md`。

系统只提供现行 v2 入口，包括账号、稳定房间、新版网页、观战、第二屏和复盘。语音默认关闭；配置声网 `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` 后启用。踢人、终局关房和频道对账还需要 `AGORA_CUSTOMER_KEY` / `AGORA_CUSTOMER_SECRET`。

## 更新

```bash
git pull
./deploy/update.sh           # Windows: deploy\update.ps1
```

日常启停使用 `deploy/start.sh` / `deploy/stop.sh`，Windows 使用对应 `.ps1`。

## 开发与测试

构筑、测试和运行都在容器内执行：

```bash
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml up -d
```

镜像构建包含类型检查、全部保留的单元测试和 web-v2 打包。日常改动默认只跑相关测试：

```bash
docker compose -f deploy/compose.frontend.yml run --rm test node scripts/test-incremental.mjs tests/xxx.test.ts
docker compose -f deploy/compose.frontend-acceptance.yml --profile acceptance run --rm browser npx playwright test --config=playwright.v2.config.ts specs-v2/xxx.spec.ts
```

E2E 需先启动 acceptance 的 `api` 和 `web`。全量 E2E 只在明确要求时运行。

## 目录

| 目录 | 内容 |
| --- | --- |
| `engine/` | 纯规则引擎：状态和动作生成新状态与事件 |
| `visibility/` | 授权投影与复盘视图 |
| `server/` | 共享房间、命令、昼夜驱动和日志 |
| `server/v2/` | 账号、稳定房间、HTTP API、Socket.IO、媒体与视图 |
| `rulesets/` | 板子配置与验证器 |
| `web-v2/` | React + Vite 现行前端 |
| `contracts/` | 客户端契约 2.2 类型 |
| `voice/` | 声网凭证、媒体回收和频道管理 |
| `docs/` | 当前规则、契约、前端和素材文档 |
| `tests/` | Vitest 与契约 2.2 夹具 |
| `e2e/` | Playwright v2 端到端验收 |
| `deploy/` | Dockerfile、Compose、安装更新脚本和运行手册 |

## 协作

`main` 分支受保护。从短期功能分支发起 Pull Request，未经明确指令不推送远程。玩法规则改动必须同步规则条款、测试和当前文档；客户端只能提交意图，身份和权限由服务端解析。
