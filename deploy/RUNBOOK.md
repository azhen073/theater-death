# 剧院死神 · 当前运行手册

适用于 `v2.0.8-alpha`。系统只提供 v2 入口，玩家电脑和第三方服务器使用同一 Docker 镜像。

## 1. 环境

- 玩家电脑：Windows 10/11、macOS 12+ 或常见 Linux 桌面，安装 Docker Desktop。
- 服务器：Ubuntu、Debian 等常见 Linux，安装 Docker Engine 和 Compose v2。
- 建议至少 2 GB 可用内存。宿主机无需 Node.js。
- 数据保存在 `data-v2/`，旧 `data/` 不再由当前 Compose 挂载，也不会被安装或更新脚本主动删除。

## 2. 安装

```bash
git clone https://github.com/azhen073/theater-death.git
cd theater-death
./deploy/install.sh
```

Windows 使用 `deploy\install.ps1`。安装脚本生成 `.env`、构建镜像并启动服务。浏览器打开 `http://localhost:3000`，注册账号后创建房间并分享房间码。

常用环境变量：

| 键 | 用途 |
| --- | --- |
| `APP_PORT` | 宿主机端口，默认 3000 |
| `PUBLIC_BASE_URL` | 当前网页入口；公网必须是 HTTPS 地址 |
| `NODE_ENV` | 服务器使用 `production`，本地 HTTP 调试使用 `development` |
| `SESSION_SECRET` | 会话签名密钥，使用安装脚本生成的随机值 |
| `SESSION_COOKIE_SECURE` | HTTPS 部署设为 `true` |
| `ADMIN_PASSWORD` | 可选管理后台密码，长度 16–256 |
| `VOICE_ENABLED` | 是否启用声网语音 |
| `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` | 声网凭证签发配置 |
| `AGORA_CUSTOMER_KEY` / `AGORA_CUSTOMER_SECRET` | 踢人、关房和频道对账所需 REST 凭据 |
| `AGORA_REST_BASE_URL` | 可选 REST 区域地址；中国区留空使用默认值 |

`.env` 含有秘密，不得提交到版本库。

## 3. 启停与更新

```bash
./deploy/start.sh
./deploy/stop.sh
```

Windows 使用对应 `.ps1`。手动启停：

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d
docker compose --env-file .env -f deploy/docker-compose.yml down
```

更新：

```bash
git pull
./deploy/update.sh
```

`update` 拉取 CI 镜像并重启；需要从本地源码构建时使用 `install`。查看状态和日志：

```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f app
```

## 4. 公网部署

可使用 Cloudflare Tunnel 或 Nginx/Caddy 反向代理，将公网 HTTPS 入口转发到 `localhost:3000`。随后设置：

```dotenv
PUBLIC_BASE_URL=https://你的域名
SESSION_COOKIE_SECURE=true
NODE_ENV=production
```

重启服务，并从外部网络验证网页和语音。网页可达不代表声网媒体链路可用。

## 5. 房间与数据

- 在线房间是内存态，服务重启后旧房间码失效；SQLite 用于账号和审计，不承诺对局崩溃恢复。
- 房主可在任意阶段解散房间；对局中解散按 `aborted` 记录。
- 房主在大厅退出会解散房间，对局中退出是暂离，复盘中退出是普通离开。
- 房主由在线、连接和会话有效的正式成员继任，不看游戏内生死。
- 全员离线满 24 小时的房间会被回收。
- `GET /healthz` 返回服务状态、契约版本和规则版本。
- `GET /api/v2/diagnostics` 需登录，可查看房间和连接计数。

备份前先停止服务，再完整复制 `data-v2/`，包括 SQLite 可能存在的 WAL/SHM 文件。恢复时必须使用兼容的代码和数据库结构。不要在服务写入期间只复制单个数据库文件。

## 6. 语音

未启用语音或缺少 App ID/证书时，服务以文字模式运行。媒体故障不改变胜负，也不暂停对局计时。

- 对局内发布权按规则阶段授予；夜间和投票等禁止阶段不能开麦。
- 白天自由发言阶段允许全体存活玩家同时开麦。
- 大厅与复盘允许正式玩家自由开麦，观众和第二屏只能订阅。
- 大厅与复盘使用 `l_<roomId>` 房间频道；对局使用 `gameId` 频道。开局关闭房间频道，终局后返回房间频道。
- 发布凭证有效期为 150 秒，客户端负责续期；权限收回时服务端下发订阅凭证。当前已接受的风险是声网侧连麦鉴权不能作为唯一强制保障。
- 生产使用踢人、终局关房和频道对账时，必须配置客户 ID 和客户密钥。
- 对账每 5 秒检查房间频道和对局频道，只踢未知 UID；不会仅因合法听众未发流而踢人。

配置：

```dotenv
VOICE_ENABLED=true
AGORA_APP_ID=<App ID>
AGORA_APP_CERTIFICATE=<App Certificate>
AGORA_CUSTOMER_KEY=<客户 ID>
AGORA_CUSTOMER_SECRET=<客户密钥>
AGORA_REST_BASE_URL=
```

修改后重启服务。真实语音验证必须使用有效声网项目和两个实际客户端，不能用文字模式或 mock 替代。

## 7. 故障排查

| 现象 | 检查 |
| --- | --- |
| 网页无法打开 | 容器状态、`logs -f app`、`APP_PORT` 是否冲突 |
| 公网 Cookie 或登录异常 | `PUBLIC_BASE_URL`、HTTPS、`SESSION_COOKIE_SECURE` |
| 旧房间码失效 | 服务是否重启；在线房间不承诺崩溃恢复 |
| 管理后台不可用 | 是否设置并重启加载 `ADMIN_PASSWORD` |
| 语音显示文字模式 | `VOICE_ENABLED`、App ID 和 App Certificate |
| 能听不能发言 | 当前阶段、本人存活状态和服务端发布授权 |
| 踢人、关房或对账失败 | 客户 ID/密钥、REST 区域地址和容器日志 |
| 对账持续失败 | 查看 `voice_reconcile_query_failed` 和管理端 `voice.reconcile` |

## 8. 开发验收

标准构建：

```bash
docker compose -f deploy/docker-compose.yml build
```

当前 v2 浏览器验收：

```bash
docker compose -f deploy/compose.frontend-acceptance.yml --profile acceptance up -d api web
docker compose -f deploy/compose.frontend-acceptance.yml --profile acceptance run --rm browser npx playwright test --config=playwright.v2.config.ts specs-v2/13-release-smoke.spec.ts
```

默认只运行相关 spec；全量 E2E 需明确要求。测试产物和截图不进入源码交付。

## 9. 不承诺

- 休眠、断电或进程崩溃后的对局恢复。
- 高可用、自动故障迁移和通用多租户平台。
- 录音、语音转写、公开匹配或管理员改判。
