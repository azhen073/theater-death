# 剧院死神 · 运行手册

面向两种部署：**玩家电脑托管**（房主自己开的临时局）与**第三方服务器托管**（朋友长期开服）。
两种部署使用**同一 Docker 镜像与编排**，只有入口和数据目录不同。

## 1 系统要求

| 部署方式 | 支持系统 | 依赖 |
| --- | --- | --- |
| 玩家电脑托管 | Windows 10/11（x64）、macOS 12+、Ubuntu 22.04+ 桌面版 | Docker Desktop，或 Docker Engine + compose v2 |
| 第三方服务器托管 | Ubuntu 22.04 / 24.04、Debian 12 等主流 Linux | Docker Engine + compose v2 |

- 运行时已锁定在镜像内（node:24.15.0-bookworm-slim），房主**无需安装 Node.js 或其他开发工具**，只需 Docker。
- 建议 2GB 以上空闲内存；13 人一局的资源占用很小（纯文字 + 可选语音）。

## 2 首次安装

1. 安装并启动 Docker（Windows/macOS 用 Docker Desktop；Linux 用 Docker Engine + compose 插件），确认 `docker --version` 可用。
2. 获取项目文件（整个目录，含 `deploy/`）。
3. 运行安装脚本（首次与日常分开）：
   - Windows：`deploy\install.ps1`
   - Linux/macOS：`./deploy/install.sh`
4. 脚本依次：生成 `.env`（含随机会话密钥）→ 构建镜像（镜像构建内含全部测试，首次约数分钟）→ 启动服务。
5. 浏览器打开 `http://localhost:3000` → 创建房间 → 把房间码发给同伴。

## 3 日常启动与停止

- 启动：`deploy\start.ps1` / `./deploy/start.sh`（输出访问入口）
- 停止：`deploy\stop.ps1` / `./deploy/stop.sh`
- 手动等价命令（在项目根目录执行）：

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d
docker compose --env-file .env -f deploy/docker-compose.yml down
```

## 4 部署与公网入口

### 4.1 玩家电脑托管（同一网络）

朋友在同一网络时，访问 `http://<房主电脑IP>:3000`（Windows 用 `ipconfig` 查 IPv4 地址；防火墙需放行 3000 端口）。

### 4.2 第三方服务器托管（推荐；含公网入口）

1. 服务器安装 Docker Engine + compose v2（Ubuntu 22.04+）。
2. 拉取项目并一键安装：

```bash
git clone https://github.com/azhen073/theater-death.git
cd theater-death
./deploy/install.sh
```

3. 为公网配置 HTTPS 入口（任选其一）：
   - **Cloudflare Tunnel**：服务器安装 cloudflared 并注册为系统服务；在 Zero Trust 面板创建隧道，添加公开主机名路由到 `http://localhost:3000`。出站连接，无需公网 IP、无需端口映射。
   - **反向代理**：Nginx / Caddy 转发到 `localhost:3000` 并配置 HTTPS 证书。
4. 更新 `.env`：`PUBLIC_BASE_URL=https://你的域名`、`SESSION_COOKIE_SECURE=true`；重启服务生效：

```bash
./deploy/stop.sh && ./deploy/start.sh
```

5. 从**外部网络**（例如手机流量、朋友家宽）访问域名验证可达性。

**更新已部署的版本（快，推荐）**：

```bash
cd theater-death
git pull
./deploy/update.sh   # 拉取 CI 构建的最新镜像并重启（约 1-2 分钟）
```

镜像由 GitHub Actions 在推送代码时自动构建并发布到 `ghcr.io/azhen073/theater-death:latest`，服务器只下载变动层，不装依赖、不跑测试。

**从源码构建更新（慢，备用；CI 镜像不可用时）**：

```bash
cd theater-death
git pull
./deploy/install.sh   # 在本机构建镜像（含全部测试）
```

> 网页入口连通不等于语音媒体可用；媒体通道需按 §7 独立验证。

## 5 数据与日志

- 数据库：`data/theater_death.sqlite`（对局事件与聊天记录；SQLite 单文件）
- 容器日志：`docker compose -f deploy/docker-compose.yml logs -f app`
- 导出：停止服务后直接复制 `data/theater_death.sqlite`
- 删除：停止服务后删除该文件（对局数据不可恢复）
- 数据库与日志**不在网页静态目录内**，不对外开放下载

## 6 配置与秘密

`.env`（安装脚本自动生成；**不要提交到版本库**）：

| 键 | 说明 |
| --- | --- |
| APP_PORT | 宿主机映射端口（默认 3000） |
| PUBLIC_BASE_URL | 入口地址（公网部署填隧道或反代域名） |
| SESSION_SECRET | 会话签名密钥；轮换后所有人需重新加入（房间是内存态，不恢复） |
| SESSION_COOKIE_SECURE | HTTPS 部署时设为 true |
| VOICE_ENABLED / VOICE_SERVICE_URL | 语音总开关与媒体服务地址（见 §7） |

## 7 语音（公共白天语音）

- 语音未启用或媒体服务不可用时：页面明确显示「**文字测试模式**」，白天公屏照常可用，夜间仅获准阵营房文字协商；**不得声称语音功能已完成**。
- 启用后：仅公共白天允许**获准发言的存活玩家**开麦（发言许可由服务端按规则窗口签发，不只是前端置灰）；投票期间全体禁麦；夜间全体禁麦；死者仅公共旁听。
- 媒体失败不改变胜负、不暂停计时，自动回落文字。

## 8 故障排查

| 现象 | 排查 |
| --- | --- |
| 打不开 http://localhost:3000 | `docker compose -f deploy/docker-compose.yml ps` 看容器状态；`logs app` 看报错；端口被占用时改 `.env` 的 APP_PORT |
| 日志提示 SESSION_SECRET 未设置 | 用安装脚本生成 `.env`；手动部署确保含随机值 |
| 隧道 530 / error 1033 | cloudflared 连接器没连上：检查本机 cloudflared 进程与 Zero Trust 面板 Tunnel 状态 |
| 加入房间提示房间不存在 | 房间在后端内存中：服务重启后旧房间码失效，重新创建房间即可 |
| 构建失败 | 多为网络问题：确认 Docker 可用、registry 加速已配置，重跑安装脚本 |

## 9 不承诺

- 休眠、断电、进程崩溃后的对局恢复（房间为内存态；数据库只用于事件与聊天审计）
- 高可用、自动迁移、多租户平台
- 代购服务器、域名或语音套餐的授权（由部署方自行决定）
