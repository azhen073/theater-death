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

### 4.1.1 观战（v1.2）

入口页填昵称 + 房间码 →「观战（只看不玩）」→ 从公开名单选择要跟随的玩家 → 进入只读观战模式。

- 观战 = **绑定一名玩家的只读第二屏**：可见该玩家的完整视角（含其身份与私有信息），不能提交任何操作、发言或开麦；语音可旁听不可说。
- 每名玩家最多一名观众（先到先得）；观众不占玩家席位、不影响开局与胜负；大厅期、对局中、终局后均可加入（终局后看复盘）。
- 退出观战点界面上的「退出观战」；换绑目标 = 退出后重新观战。
- 同一浏览器“玩 + 看”互斥（会话单一）：观战请用无痕窗口或另一台设备。
- **计量提示**：观众加入语音同样计入媒体服务用量（LiveKit Cloud 免费层按参与者分钟计费）。

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
| VOICE_ENABLED / VOICE_SERVICE_URL / VOICE_ADMIN_URL | 语音总开关与媒体地址（见 §7） |
| LIVEKIT_API_KEY / LIVEKIT_API_SECRET | LiveKit 密钥（安装脚本自动生成；托管服务时填控制台中的值） |
| LIVEKIT_NODE_IP | 自托管 LiveKit 对外公布的节点地址（本地 127.0.0.1；局域网填宿主内网 IP） |
| COMPOSE_PROFILES | 启用自托管语音时设为 voice，compose 会额外启动 livekit 容器 |

## 7 语音（公共白天语音）

- **未启用或媒体不可用时**：页面明确显示「**文字测试模式**」，白天公屏照常可用，夜间仅获准阵营房文字协商；**不得声称语音功能已完成**。媒体失败不改变胜负、不暂停计时，自动回落文字。
- **发言许可**（R-43，服务端实施，不只是前端置灰）：竞选候选发言轮（仅当前候选）、发言轮（仅当前发言者）、遗言（仅遗言者）、平票者发言轮（仅当前平票发言者）可开麦；竞选/放逐投票与重投期间、夜间（含晨间结算）全体禁麦；死者仅公共旁听。
- 凭证为短期最小权限：加入语音时签发，**不含发布权**；发布权由服务端在每次状态推进时同步给媒体服务，重连后重新校验资格；玩家自己的静音不会被流程切换强制取消。

### 7.1 本机 / 局域网自托管 LiveKit

1. `.env` 设置：`VOICE_ENABLED=true`、取消 `COMPOSE_PROFILES=voice` 注释、`LIVEKIT_NODE_IP=<宿主内网 IP 或 127.0.0.1>`（自托管密钥安装脚本已生成）。
2. `deploy/update.sh` 或 `deploy/start.sh` 重启后，compose 会额外启动 livekit 容器（版本锁定 v1.9.7，配置见 `deploy/livekit.yaml`）。
3. `VOICE_SERVICE_URL`：本机自测填 `ws://localhost:7880`；局域网填 `ws://<宿主内网IP>:7880`。
4. 浏览器必须能**直连**媒体端口 7881/TCP、7882/UDP——网页经隧道/反代可达**不等于**语音可用。

### 7.2 服务器公网自托管 LiveKit（有公网入站时，动态 IP 可用）

前提：出口有**公网 IP**（IPv4 或 IPv6）且能在路由器/光猫上做端口映射。LiveKit 会自动用 STUN 发现当前公网 IP，**动态 IP 变化后重启容器即可**，不需要改配置。

1. **端口映射**（路由器/光猫 → 服务器内网 IP）：`UDP 7882`、`TCP 7881`；服务器防火墙放行同样两个端口（如 `sudo ufw allow 7881/tcp && sudo ufw allow 7882/udp`）。
2. **信号域名**：反代或 Cloudflare Tunnel 把 `livekit.<你的域名>` 指向本服务 `7880`（Tunnel 路由即可，媒体不走隧道）。
3. `.env` 设置：
   ```
   VOICE_ENABLED=true
   COMPOSE_PROFILES=voice
   LIVEKIT_NODE_IP=                # 必须留空：交给 STUN 自动发现
   LIVEKIT_CONFIG_FILE=livekit-public.yaml
   VOICE_SERVICE_URL=wss://livekit.<你的域名>
   ```
4. 重启后验证：服务器日志出现 `nodeIP: <当前公网 IP>`；外网（手机流量）打开游戏加入语音实测。

### 7.3 托管媒体（服务器无公网入站 / 不便做端口映射时）

媒体流量不能经 HTTP 反向代理/隧道，服务器无法开放 7881/7882 时应使用托管服务（如 LiveKit Cloud 免费层）：

1. 在媒体服务控制台创建项目，取得 **WebSocket URL**（如 `wss://xxx.livekit.cloud`）与 **API Key / Secret**。
2. `.env`：`VOICE_ENABLED=true`、`VOICE_SERVICE_URL=<wss 地址>`、`VOICE_ADMIN_URL=`（留空，自动取同值）、`LIVEKIT_API_KEY/SECRET=<控制台值>`；**不要**设置 `COMPOSE_PROFILES`（不启动本地 livekit 容器）。
3. 免费层超出月度额度后新请求自动失败（不产生费用），页面回落文字模式。

## 8 故障排查

| 现象 | 排查 |
| --- | --- |
| 打不开 http://localhost:3000 | `docker compose -f deploy/docker-compose.yml ps` 看容器状态；`logs app` 看报错；端口被占用时改 `.env` 的 APP_PORT |
| 日志提示 SESSION_SECRET 未设置 | 用安装脚本生成 `.env`；手动部署确保含随机值 |
| 隧道 530 / error 1033 | cloudflared 连接器没连上：检查本机 cloudflared 进程与 Zero Trust 面板 Tunnel 状态 |
| 加入房间提示房间不存在 | 房间在后端内存中：服务重启后旧房间码失效，重新创建房间即可 |
| 语音按钮提示连接失败 | ① 浏览器能否访问 `VOICE_SERVICE_URL`（自托管须直连 7881/7882）；② 托管密钥是否正确；③ `docker compose ... logs livekit`（自托管） |
| 加入语音后说不了话 | 正常受限：界面会显示原因（夜间静音 / 投票禁麦 / 非你的发言时间 / 已出局旁听）；服务端发布权不受浏览器本地状态影响 |
| 构建失败 | 多为网络问题：确认 Docker 可用、registry 加速已配置，重跑安装脚本 |

## 9 端到端验收（E2E，开发/验收用，可选）

全部在容器内运行，媒体后端使用自托管 LiveKit（**不依赖云凭证**），不影响生产部署。

1. 构建（首次或代码变更后）：`docker compose -f deploy/docker-compose.yml --env-file deploy/e2e.env build app e2e`
2. 全部用例（约 18 分钟）：`docker compose -f deploy/docker-compose.yml --env-file deploy/e2e.env --profile e2e run --rm e2e npx playwright test`
3. 容量测试（正式板完整日夜循环，约 4 分钟）：`… run --rm e2e node capacity.mjs`
4. 结果：项目根 `e2e-results/`（HTML 报告 `html/index.html`、失败截图/trace、`capacity-*.json`）

说明：功能用例使用实验模式缩短板（大厅有醒目提示，不代表正式板时长）；端口冲突时改 `deploy/e2e.env` 的 `APP_PORT`；开发迭代可挂载 `-v "<repo>/e2e:/src:ro"` 并前置 `cp -r /src/. /e2e/`。

## 10 不承诺

- 休眠、断电、进程崩溃后的对局恢复（房间为内存态；数据库只用于事件与聊天审计）
- 高可用、自动迁移、多租户平台
- 代购服务器、域名或语音套餐的授权（由部署方自行决定）
