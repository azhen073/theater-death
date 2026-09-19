# 新版公共语音与自托管 LiveKit

本地实现与真实媒体测试结果见 `frontend-v2-voice-acceptance.md`。

新版公共语音使用 LiveKit SFU。玩家主动加入后默认只听；只有服务端快照的 `canPublishVoice` 为 true 时才可手动开启麦克风。权限撤销、媒体重连、离开对局页、接管、离房和终局都会关闭麦克风并清除本次开麦意图。下一次发言必须重新点击。观众只能旁听。媒体失败不影响文字、行动或投票。

## 本地 5174 验证

默认仍以文字模式启动：

```powershell
.\deploy\frontend-local.ps1 start
```

已构建包含语音前端的候选镜像后，可显式启动本地 LiveKit：

```powershell
docker pull livekit/livekit-server:v1.9.7
.\deploy\frontend-local.ps1 start -Voice on
.\deploy\frontend-local.ps1 status -Voice on
.\deploy\frontend-local.ps1 stop -Voice on
```

浏览器使用 `ws://localhost:7880`，后端通过 Compose 网络使用 `http://livekit:7880`。本地开发凭证只用于 localhost，不能用于公网。

## 公网同机部署模板

1. 复制 `deploy/voice-selfhost.env.example` 的字段到服务器专用 `.env`，生成随机 API key 与至少 32 字符的 secret。
2. 在服务器工作目录加载 `.env` 后运行 `sh deploy/render-livekit-config.sh`，生成被 git 忽略的 `livekit.generated.yaml`。
3. 将现有新版应用 Compose 与 `deploy/compose.voice-selfhost.yml` 叠加启动。应用和 LiveKit 必须在同一 Compose 网络，且应用服务名为 `app`。
4. 按 `deploy/nginx-livekit.conf.example` 配置游戏与语音的 HTTPS/WSS 入口。模板不负责申请域名或证书。
5. 安全组与主机防火墙放行 TCP 7881 和 UDP 7882；7880 只绑定回环并由 Nginx代理。

示例命令中的基础 Compose 路径按服务器实际部署文件替换：

```sh
set -a
. ./.env
set +a
sh deploy/render-livekit-config.sh
docker compose --env-file .env -f docker-compose.yml -f deploy/compose.voice-selfhost.yml config
docker compose --env-file .env -f docker-compose.yml -f deploy/compose.voice-selfhost.yml up -d
```

检查 `/api/v2/bootstrap` 的 `features.voice=true`、应用与 LiveKit 容器日志，以及浏览器的加入和旁听状态。回退时令 `VOICE_ENABLED=false` 并只启动基础 Compose；账户数据卷不受影响。

公网正式启用需要浏览器认可的 HTTPS/WSS。当前首版只提供 UDP 7882 和 TCP 7881 回退，不包含 TURN/TLS。电脑与手机跨网络互听、移动网络回退及 13 人公网容量必须在部署后另行验收。
