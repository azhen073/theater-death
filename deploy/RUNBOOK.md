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
5. 浏览器打开 `http://localhost:3000` → 注册/登录 → 进入大厅 → 创建房间 → 把房间码发给同伴。

### 2.1 入口版本与数据（默认新版 v2）

- 默认入口即**新版（v2）体系**：新前端（大厅 / 昼夜行动 / 情报 / 公屏 / 观战 / 终局复盘）＋ 账号系统；数据存于 `data-v2/`（旧版数据 `data/` 保留不删）。
- **回滚旧版**：在 `.env` 设 `ENTRY=v1` 后执行 `deploy/update.sh`（或 `up -d`），即回到旧版入口与旧数据；删除该行恢复新版。
- `.env` 的 `NODE_ENV`：服务器保持 `production`（`PUBLIC_BASE_URL` 必须为 HTTPS 域名）；本机以 http 调试需设 `NODE_ENV=development`。
- 管理后台为可选功能：`.env` 设 `ADMIN_PASSWORD`（16–256 位）后可用，不设置即关闭。

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
- **计量提示**：观众加入语音同样计入媒体服务用量（声网免费层按参与者分钟计费，每月 1 万分钟）。

### 4.1.2 房主管理（踢人，v1.3）

- **移出成员**：仅未开局大厅期；房主在大厅成员行点「移出」并确认。被移出者释放席位、**可重新加入**（清位语义，不拉黑）；其观战者连带移除。
- **移出观战者**：不限阶段（对局中也可）；被移出者若在语音中会被一并移出媒体房间。
- 房主不能移出自己（要结束请用「解散房间」）。被移出者在数秒内自动回到入口页并显示提示。

### 4.1.3 自定义板子（实验模式，v1.4）

入口页「自定义板子…」可调整各角色数量并直接建房（其余参数固定为默认 13 人板值）。

- 编辑器实时校验（与服务器同一份校验器）：神职不可为空、平民不可为空、魂灵 / 死神 / 科研员至少 1、特殊角色最多 1；有错时禁用创建。
- 建房后大厅显示实验模式横幅；开局人数 = 板子总人数（如 10 人板需 10 名玩家全部准备）。
- 仅供测试：并非任意人数 / 组合都经过验证；自定义板子不保存在浏览器（重编需重新调整）；已建房的板子快照保存在服务器数据库（用于复盘与审计）。

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

### 5.1 房间生命周期与回收

- 房间是**内存态**：服务重启即全部失效，旧房间码作废（数据库只用于事件与聊天审计）。
- **解散**：仅房主可用，**任意阶段**生效——大厅与复盘直接关闭房间；对局进行中会立即终止本局，未产生胜负的对局按 `aborted` 记入审计、其余成员即时收到 `dissolved` 通知。旧版入口（`ENTRY=v1`）只允许大厅期解散，对局中退出一律 409。
- **房主退出**：新版入口下，房主在**大厅**退出即解散整房；**对局进行中**退出是「暂离」（席位与计时保留，由其他在线正式成员接任房主）；**复盘**退出是普通离开（房间保留、其他人继续看复盘、房主同样接任）。旧版入口下房主在大厅退出即解散，终局后退出只释放自己的席位。
- **房主继任**：接任只要求「在线 + 有连接 + 会话有效」，**不看游戏内生死**——已出局的正式成员也可以继任房主（因此同样能解散房间或移交房主）；完全无人在线时暂时没有房主，房主类按钮对所有人隐藏。
- **遗弃回收（24 小时）**：新版按「**全员离线**」计算——有正式成员但无人在线满 24 小时即回收（未终局按 `aborted` 记账）；旧版没有在线状态，按「**房间无活动**」计算——任何房间请求或实时握手都算活动，满 24 小时无活动即回收。回收后成员下次请求得到 404 并自动回到入口页。
- 运维排查：`GET /healthz` 看存活；新版 `GET /api/v2/diagnostics`（需登录）返回 `rooms` / `playingRooms` / `connections`，可判断是否有房间堆积（房间上限 100，达到后新建返回 503 `room_capacity`）。

## 6 配置与秘密

`.env`（安装脚本自动生成；**不要提交到版本库**）：

| 键 | 说明 |
| --- | --- |
| APP_PORT | 宿主机映射端口（默认 3000） |
| PUBLIC_BASE_URL | 入口地址（公网部署填隧道或反代域名） |
| SESSION_SECRET | 会话签名密钥；轮换后所有人需重新加入（房间是内存态，不恢复） |
| SESSION_COOKIE_SECURE | HTTPS 部署时设为 true |
| VOICE_ENABLED | 语音总开关（见 §7） |
| AGORA_APP_ID / AGORA_APP_CERTIFICATE | 声网项目的 App ID 与 App Certificate（签发语音 token；不入版本库） |
| AGORA_CUSTOMER_KEY / AGORA_CUSTOMER_SECRET | 声网频道管理 REST 凭据（踢人/终局关房；控制台「设置 → RESTful API」生成；不入版本库） |

## 7 语音（声网托管，公共白天语音）

- **未启用或声网不可用时**：页面明确显示「**文字测试模式**」，白天公屏照常可用，夜间仅获准阵营房文字协商；**不得声称语音功能已完成**。媒体失败不改变胜负、不暂停计时，自动回落文字。
- **发言许可**（R-43，服务端实施）：竞选候选发言轮（仅当前候选）、发言轮（仅当前发言者）、遗言（仅遗言者）、平票者发言轮（仅当前平票发言者）可开麦；竞选/放逐投票与重投期间、夜间（含晨间结算）全体禁麦；死者仅公共旁听。
- **权限实现（连麦鉴权 + 短期 token）**：加入凭证为订阅角色（可听不可发）；轮到发言时服务端在状态推进时下发**发布凭证**（默认 10 分钟，覆盖最长发言窗口），前端 `renewToken` 即时生效；权限收回时下发订阅凭证即时降权，发布权限到期由声网侧自动兜底收回。玩家自己的静音不会被流程切换强制取消。踢人 = 一次性踢出（频道内清位，可立即重进，不拉黑）。

### 7.1 配置（声网，免费层每月 1 万分钟）

1. 注册声网账号（shengwang.cn，需实名认证），控制台创建项目（安全模式），取得 **App ID** 与 **App Certificate**（控制台列表里可能掩码显示，点复制图标获取真值）。
2. **开启「连麦鉴权」**：控制台「全部产品 → 实时互动 RTC → 功能配置 → 连麦鉴权」启用（**开启后不可关闭**，约 5 分钟生效）。
3. 生成 **频道管理 REST 凭据**：控制台「设置 → RESTful API → 添加密钥」，下载 `key_and_secret.txt`（**下载后控制台不再展示**，妥善保管）。
4. `.env` 设置：
   ```
   VOICE_ENABLED=true
   AGORA_APP_ID=<控制台 App ID>
   AGORA_APP_CERTIFICATE=<控制台 App Certificate>
   AGORA_CUSTOMER_KEY=<客户 ID>
   AGORA_CUSTOMER_SECRET=<客户密钥>
   ```
5. 重启应用（`deploy/update.sh` 或 `deploy/start.sh`），页面语音面板不再显示"文字测试模式"即为生效。
6. 计费：免费层按「人×分钟」每月 1 万分钟（13 人 1 小时局约 780 分钟），超出按 7 元/千分钟；用量在声网控制台查看。

### 7.2 关于媒体链路

- 声网为托管服务：客户端就近接入国内边缘节点，**服务器不需要开放任何入站端口**，隧道/反代只需要承载网页与信令。
- 某网络下语音不可用时页面自动回落文字模式，不阻塞对局；排查顺序见 §8。

## 8 故障排查

| 现象 | 排查 |
| --- | --- |
| 打不开 http://localhost:3000 | `docker compose -f deploy/docker-compose.yml ps` 看容器状态；`logs app` 看报错；端口被占用时改 `.env` 的 APP_PORT |
| 日志提示 SESSION_SECRET 未设置 | 用安装脚本生成 `.env`；手动部署确保含随机值 |
| 隧道 530 / error 1033 | cloudflared 连接器没连上：检查本机 cloudflared 进程与 Zero Trust 面板 Tunnel 状态 |
| 加入房间提示房间不存在 | 房间在后端内存中：服务重启后旧房间码失效，重新创建房间即可 |
| 语音按钮提示连接失败 | ① `.env` 的 `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` 是否与项目一致；② 控制台是否已开启「连麦鉴权」；③ `logs app` 查看服务端报错 |
| 加入语音后说不了话 | 正常受限：界面会显示原因（夜间静音 / 投票禁麦 / 非你的发言时间 / 已出局旁听）；发布权由服务端通过短期 token 控制，不受浏览器本地状态影响 |
| 构建失败 | 多为网络问题：确认 Docker 可用、registry 加速已配置，重跑安装脚本 |

## 9 端到端验收（E2E，开发/验收用，可选）

全部在容器内运行；语音用例经**声网测试项目**（消耗少量免费额度）验证，需要项目根 `.env` 提供 `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE`。

1. 构建（首次或代码变更后）：`docker compose -f deploy/docker-compose.yml --env-file .env --env-file deploy/e2e.env build app e2e`
2. 语音相关用例：`docker compose -f deploy/docker-compose.yml --env-file .env --env-file deploy/e2e.env --profile e2e run --rm e2e npx playwright test specs/01-smoke.spec.ts specs/02-voice.spec.ts`
3. 全部用例：`… --profile e2e run --rm e2e npx playwright test`
4. 容量测试（正式板完整日夜循环，约 4 分钟）：`… run --rm e2e node capacity.mjs`
5. 结果：项目根 `e2e-results/`（HTML 报告 `html/index.html`、失败截图/trace、`capacity-*.json`）

说明：功能用例使用实验模式缩短板（大厅有醒目提示，不代表正式板时长）；端口冲突时改 `deploy/e2e.env` 的 `APP_PORT`；开发迭代可挂载 `-v "<repo>/e2e:/src:ro"` 并前置 `cp -r /src/. /e2e/`。

## 10 不承诺

- 休眠、断电、进程崩溃后的对局恢复（房间为内存态；数据库只用于事件与聊天审计）
- 高可用、自动迁移、多租户平台
- 代购服务器、域名或语音套餐的授权（由部署方自行决定）
