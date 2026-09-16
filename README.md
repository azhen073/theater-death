# 剧院死神（Theater Death）

13 人 9 身份的社交推理游戏**在线法官**：服务端持有真实状态并做全部裁决，纯规则引擎 + Socket.IO 实时推送 + 网页前端；支持「玩家电脑 / 第三方服务器」两种托管（同一 Docker 镜像）。

- 玩法权威：`theater_death_rulebook_v1.1.md`（含 S3 裁定）
- 工程规格：`theater_death_development_requirements_v1.1.md`
- 进度与交接：`PROGRESS.md`

## 快速开始（Docker）

宿主机只需 Docker（无需 Node.js）：

```bash
git clone https://github.com/azhen073/theater-death.git
cd theater-death
./deploy/install.sh          # Windows: deploy\install.ps1
```

浏览器打开 `http://localhost:3000` → 创建房间 → 把房间码发给同伴。部署、公网入口、运维见 `deploy/RUNBOOK.md`。

## 更新

```bash
git pull
./deploy/update.sh           # 拉取 CI 构建的镜像，约 1-2 分钟
```

## 开发与测试

全部构筑 / 测试 / 运行都在容器内执行（与宿主机隔离）：

```bash
docker compose -f deploy/docker-compose.yml build   # 构建 = 类型检查 + 全部测试 + 前端打包
docker compose -f deploy/docker-compose.yml up -d
```

推送代码到 `main` 后，GitHub Actions 会自动构建（镜像构建内含全部测试）并发布 `ghcr.io/azhen073/theater-death:latest`。

## 目录结构

| 目录 | 内容 |
| --- | --- |
| `engine/` | 纯规则引擎（状态 + 动作 → 状态 + 事件，无时钟/网络依赖） |
| `visibility/` | 授权投影（先裁剪再发送，复盘视图） |
| `server/` | 会话、房间、夜间/白天驱动、HTTP API、Socket.IO 实时 |
| `rulesets/` | 板子配置与验证器（正式 / 实验模式） |
| `web/` | React + Vite 前端（同镜像交付） |
| `tests/` | Vitest 全量测试（166 用例） |
| `deploy/` | Dockerfile、compose、安装/更新脚本、运行手册 |
