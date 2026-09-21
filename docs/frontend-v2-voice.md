# 新版公共语音（声网）

本地实现与真实媒体测试结果见声网语音验收记录（该记录为贡献者本地文档，未随仓库入库）。

新版公共语音使用声网 Agora RTC（连麦鉴权 + 短期 token 授权）。**正式玩家进入对局（playing）且在线时自动加入语音**（订阅即可听；本人点「离开语音」后本局不再自动重连）；只有服务端快照的 `canPublishVoice` 为 true 时才能发言。权限撤销、媒体重连、离开对局页、接管、离房和终局都会关闭麦克风并清除本次开麦意图。**默认「轮到我发言时自动开麦」**（显示与动画设置里可关）：进入自己的正式发言窗口（服务端授予发布权）时自动开麦，每个发言窗口只自动开一次，手动关麦后不重开；未开启该偏好或自动开麦失败时仍可点「开启麦克风」。观战者与绑定第二屏保持手动「加入旁听」。媒体失败不影响文字、行动或投票。

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
| 麦克风增益 | 0–150 滑杆，仅在已开麦时出现；**>125 时关闭 AGC** 并显示「AGC 已关闭」 | 只影响别人听到的音量；每次重新开麦都会新建采集轨道，**会话会记住增益并自动重新应用**（换设备同理） |

实现要点与已知限制：

- **纯本机信号与偏好**：电平与音量都不上报服务端、不入日志与复盘；偏好与显示设置同源存于 `localStorage`（`voiceLevels` / `voiceOutput` / `voiceInput` / `voiceMuted`，默认 `true` / `100` / `100` / `false`），非法值钳制到 0–100。
- **电平来源**：`enableAudioVolumeIndicator(200ms)` 的 `volume-indicator` 事件（含本机 uid）。新版服务端的媒体 uid 是不透明递增编号、不在快照里，因此不做 uid↔座位映射；由于开麦时段内**只有当前发言者持有发布权**，远端电平可归属为当前发言者。
- **减少动画**：电平是离散段且不带动画/过渡，因此 `[data-reduced-motion='true']` 下无需额外分支，天然不闪动。
- **「音量指示」关闭时**：只隐藏电平（自己的电平条与发言者的百分比），**"谁在发言"照旧显示**（保留座位号；静音时仍是「N号 已静音」）；输出音量与麦克风增益不受影响。
- **未实现**：座位卡上的电平环（需要独立订阅，避免 200ms 一次把整块棋盘重渲染）、每玩家单独音量、以及"开着麦但没有电平"的排障提示。
- **AGC 与增益的关系**：建轨时带 `AEC` / `ANS` / `AGC`。增益 ≤125 保留 `AGC: true`（自动把电平拉向目标区间）；**增益 >125 时建轨改为 `AGC: false`**，避免自动增益把手动放大压回。由于 AGC 是建轨参数、运行期没有可靠开关，**跨过 125 这条线时会重建采集轨道**（在滑杆松手提交时重建，不在拖动过程中反复重建以免断音；已在阈值外继续加减只改轨道音量、不重建）。两者叠加，因此「增益 150」不是线性的听感翻倍。
- **待核对**：`enableAudioVolumeIndicator` / `disableAudioVolumeIndicator` / `volume-indicator` 的 API 名与事件载荷、以及**本地轨道 `setVolume` 的实际上限**需按 `agora-rtc-sdk-ng` 实际 typings 与实机复核（当前用结构化垫片调用，缺失时只是没有电平，不影响通话；若 SDK 内部把上限钳到 100，则 150 档只等效于 100）。
- **验收状态（2026-09-21）**：纯模型、`VoiceSession` 与偏好模型由容器内单测覆盖（`tests/frontend-v2-voice-levels.test.ts`、`frontend-v2-voice-session.test.ts`、`frontend-v2-display-model.test.ts`，20 例全过，含 0–150 钳制、AGC 阈值边界与跨阈值重建轨道）+ `typecheck:web:v2` / `typecheck:web:v2-tests` 通过；**语音条界面**由夹具页用例覆盖（`e2e/specs-v2/18-voice-levels.spec.ts`：电平段数与 `aria-valuenow`、发言者与静音文案、输出/增益滑杆即时生效与落库、增益上限 150 与「AGC 已关闭」提示、关麦后隐藏、偏好关闭后只隐藏电平并保留"谁在发言"、未加入只有加入按钮；chromium 2/2 + webkit 2/2）。**真实媒体仍未验**：加入频道、开麦、麦克风增益与 `AGC` 的实际听感需要声网凭据（`16-voice` 环境门控）。
