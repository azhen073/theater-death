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

## 音量指示与音量调节（v2.0.3-alpha）

语音条在原有连接/开麦控制之外提供四项本机能力：

| 项 | 行为 | 边界 |
| --- | --- | --- |
| 自己的电平 | 开麦后显示 5 段离散电平（`role="meter"`） | 仅本机可见 |
| 当前发言者 | 显示「N号 正在发言 · X%」；输出静音时改为「N号 已静音」 | 只在 R-43 的四个开麦时段出现（服务端 `day.currentSpeakerId` 非空）；投票/夜间/晨间结算等窗口不显示 |
| 输出音量 + 静音 | 0–100 滑杆 + 一键静音（远端播放） | 只影响本机听到的音量，不改变任何人的发言权与计时 |
| 麦克风增益 | 0–100 滑杆，仅在已开麦时出现 | 只影响别人听到的音量；每次重新开麦都会新建采集轨道，**会话会记住增益并自动重新应用**（换设备同理） |

实现要点与已知限制：

- **纯本机信号与偏好**：电平与音量都不上报服务端、不入日志与复盘；偏好与显示设置同源存于 `localStorage`（`voiceLevels` / `voiceOutput` / `voiceInput` / `voiceMuted`，默认 `true` / `100` / `100` / `false`），非法值钳制到 0–100。
- **电平来源**：`enableAudioVolumeIndicator(200ms)` 的 `volume-indicator` 事件（含本机 uid）。新版服务端的媒体 uid 是不透明递增编号、不在快照里，因此不做 uid↔座位映射；由于开麦时段内**只有当前发言者持有发布权**，远端电平可归属为当前发言者。
- **减少动画**：电平是离散段且不带动画/过渡，因此 `[data-reduced-motion='true']` 下无需额外分支，天然不闪动。
- **「音量指示」关闭时**：自己的电平、当前发言者整条（含"谁在发言"）一起隐藏；若希望只隐藏电平而保留"谁在发言"，需另开开关。
- **未实现**：座位卡上的电平环（需要独立订阅，避免 200ms 一次把整块棋盘重渲染）、每玩家单独音量、以及"开着麦但没有电平"的排障提示。
- **待核对**：`enableAudioVolumeIndicator` / `disableAudioVolumeIndicator` / `volume-indicator` 与 `setVolume` 的取值范围需按 `agora-rtc-sdk-ng` 实际 typings 复核（当前用结构化垫片调用，缺失时只是没有电平，不影响通话）；本机采集增益与 `AGC: true` 的相互作用需实机听感确认。
- **验收状态（2026-09-21）**：纯模型与 `VoiceSession` 由容器内单测覆盖（`tests/frontend-v2-voice-levels.test.ts`、`tests/frontend-v2-voice-session.test.ts`、`tests/frontend-v2-display-model.test.ts`，18 例全过）+ `typecheck:web:v2` 通过；**语音条界面本身没有 E2E**（夹具页不挂 app shell，`16-voice` 需声网凭据），真实听感未在容器内验证。
