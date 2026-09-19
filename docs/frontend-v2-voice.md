# 新版公共语音（声网）

本地实现与真实媒体测试结果见声网语音验收记录（该记录为贡献者本地文档，未随仓库入库）。

新版公共语音使用声网 Agora RTC（连麦鉴权 + 短期 token 授权）。玩家主动加入后默认只听；只有服务端快照的 `canPublishVoice` 为 true 时才可手动开启麦克风。权限撤销、媒体重连、离开对局页、接管、离房和终局都会关闭麦克风并清除本次开麦意图。下一次发言必须重新点击。观众只能旁听。媒体失败不影响文字、行动或投票。

## 本地 5174 验证

默认仍以文字模式启动：

```powershell
.\deploy\frontend-local.ps1 start
```

启用语音需先在 `.env.frontend-local` 配置声网凭据（`AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` / `AGORA_CUSTOMER_KEY` / `AGORA_CUSTOMER_SECRET`），再叠加语音覆盖文件启动：

```powershell
.\deploy\frontend-local.ps1 start -Voice on
.\deploy\frontend-local.ps1 status -Voice on
.\deploy\frontend-local.ps1 stop -Voice on
```

声网是托管媒体服务：本地不需要启动任何媒体容器，也没有 7880/7881/7882 之类的媒体端口概念；浏览器直接就近接入声网边缘节点。本地开发凭证只用于本地测试，不能用于公网。

## 公网同机部署模板

1. 在声网控制台准备凭据：**App ID** 与 **App Certificate**（签发 token），以及「设置 → RESTful API」生成的**客户 ID / 客户密钥**（频道管理：踢人、关房）。
2. 在「全部产品 → 实时互动 RTC → 功能配置」**开启「连麦鉴权」**（开启后不可关闭，约 5 分钟生效）——它是发布权控制生效的前提。
3. 服务器 `.env` 配置：

   ```sh
   VOICE_ENABLED=true
   AGORA_APP_ID=<App ID>
   AGORA_APP_CERTIFICATE=<App Certificate>
   AGORA_CUSTOMER_KEY=<客户 ID>
   AGORA_CUSTOMER_SECRET=<客户密钥>
   ```

4. 用现有新版应用 Compose 启动即可：**不需要**额外的媒体容器、防火墙放行或 Nginx 语音代理。声网为客户端出站连接，隧道/反代只需承载网页与信令（见 `deploy/RUNBOOK.md` §7）。

检查 `/api/v2/bootstrap` 的 `features.voice=true`、应用日志以及浏览器中的加入和旁听状态。回退时令 `VOICE_ENABLED=false` 并重启应用；账户数据卷不受影响。

公网正式启用仍需浏览器认可的 HTTPS/WSS（麦克风需要安全上下文）。电脑与手机跨网络互听、移动网络表现及 13 人公网容量必须在部署后另行验收。
