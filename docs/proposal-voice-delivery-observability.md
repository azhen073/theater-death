# 语音「发得出但别人听不到」可观测性与收口方案（提案）

- 提案人：kiahir ｜ 状态：**C 组（送达回执）与 D 组（频道轮询对账）已于 2026-09-23 落地并验收**（含客户 ID/密钥真机补验，实测见 §12.13）；A/B 组经复核放弃，其余为备用方案（见需求文档文末 v2.0.6-alpha 一节）
- 日期：2026-09-22（C/D 落地 2026-09-23）｜ 适用版本：v2 入口（`2.0.6-alpha` 及其后续）
- 相关：`docs/frontend-v2-voice.md`、`docs/backend-v2-api.md`、需求文档文末 v2.0.6-alpha 一节
- 本文只谈工程实现，**不改玩法规则**：R-43 时段门控、夜间静音、契约 2.x 的编号体系照旧
- 调研进度：2026-09-22 已用**官方站 + 官方 MCP Server**逐条核对声网事实（查询用户列表/用户状态、踢人接口、Web SDK 客户端 API 与字段、连接状态、通话质量、发版说明）；同日用户决定 **不使用 NCS 事件回调**（§12.5）；新增 **§12.12**（`publish_audio` 封禁可强制收回发麦，仅作兜底）与 **§13**（客户端自检信号）

> **资料来源约定（用户明确，2026-09-22）**：声网官方文档**有且仅有** `https://doc.shengwang.cn/`；官方文档还提供 **MCP Server `https://doc-mcp.shengwang.cn/mcp`**（Streamable HTTP，工具：`search-docs` / `list-docs` / `get-doc-content`，语料即官方站内容）。凡来自 `docs.agora.io`、`api-ref.agora.io`、`docs-preview.agora.io`、`docs.agoraio.cn`、`doc-archive.shengwang.cn` 等站点的内容**一律视为待复核**，不得作为实施依据。本文每处声网事实都标注核对状态：
>
> | 状态 | 含义 | 本文现状 |
> |---|---|---|
> | ✅ 官方站已核对 | 官方站页面或 MCP 语料逐字可查 | 频率配额、封禁权限用法/语义/超时（`kicking-rule` API 参考 + 最佳实践）、Web 连接状态与原因、**Web SDK 客户端 API 清单与字段（已用 MCP 的 `get-doc-content` 逐条核对）**、发版说明相关事实、NCS 事件与签名（虽不采用） |
> | ⚠️ 仍待核对 | 只在非官方英文站见过，官方站对应页 JS 渲染、且**不在 MCP 语料**里 | **仅剩**：查询用户列表 / 查询用户状态的**响应字段级 schema**（`get-doc-content` 对这两个 operation 返回 `not found`；`kicking-rule` 系列则在语料中，已核对） |
>
> ⚠️ 剩余项的复核方式：人工在浏览器打开 `https://doc.shengwang.cn/doc/rtc/restful/channel-management/operations/get-user-property` 与 `…/get-dev-v1-channel-user-appid-channelName` 确认字段名后回填本文（其余条目均已用 MCP 核对完毕）。

## 0. 摘要（先读这一页）

**问题**：语音的"我在说话"目前只有**本地自证**（麦克风开着、电平环在动），而音频**从不经过我们的服务端**（声网边缘转发），于是出现一批"本地全绿、远端没人听到"的故障（§1.2 列了 7 条，含代码位置），现有提示覆盖不到其中最难查的几条。

**方案**：分四组收口，**A、B 零契约可先做，C 动契约，D 需凭据**。

| 组 | 做什么 | 解决什么 | 契约 | 依赖 | 建议版本 |
|---|---|---|---|---|---|
| **A** | 本地自检：`sendBitrate` 主判据 + 电平兜底，把"没采集到 / 采集到但发不出去 / 发了没人听"分开 | 设备静音、网络出口被挡 | 无 | 无 | 并入 `2.0.6-alpha` |
| **B** | 服务端静默失败显性化：媒体回收失败计数进管理端 summary | 踢人/关房失败只剩一行日志 | 无 | 无 | 并入 `2.0.6-alpha` |
| **C** | 端到端送达回执：接收端上报，服务端按发言窗口聚合，发言者看到「已送达 N/M」 | **唯一能证明"别人真的听到了"** | `PrivateGameDTO` 可选字段 + 新端点 | 无（不需要客户密钥） | 独立版本（如 `2.0.7-alpha`） |
| **D** | 声网侧硬证据：**仅轮询对账**（不使用 NCS），把"该在不在 / 不该在却在"对齐 | 客户端不配合时的服务端强制 | 无（附带可选清理） | **客户 ID/密钥** + 区域 base URL | 暂缓/待定 |
| **§13** | 横向能力层：客户端自检信号（`connectionState` / `uid` / `localTracks` / `getLocalAudioStats` 等） | 供 A、B、C 复用 | 无 | 无 | 随 A/B/C |

**官方依据**：✅ 全部声网事实已用官方站 + 官方 MCP Server 核对（含 Web SDK 客户端 API 字段级、`kicking-rule` 语义、配额 20 QPS/账号、v4.24.8 发版说明）；⚠️ 仅剩**查询类 REST 的两个字段 schema** 待人工在浏览器确认（MCP 语料不含该 operation），见顶部核对表。

**还缺你拍板**：§10 的 10 条待定项（最关键是：只做 A+B 还是做到 C；C 的真机验收是否重新引入凭据；D 是否重启凭据；版本落点）。

**文档地图**

| 章节 | 内容 |
|---|---|
| §1–§2 | 问题定位（链路、7 条"假绿"、现有信号覆盖）+ 目标 G1–G5 与非目标 |
| §3 | 四组总览表（含 §13 横向层说明） |
| §4–§7 | A / B / C / D 各组方案概要 |
| §8–§9 | 落地顺序与版本衔接、风险与代价 |
| §10 | **待定决策（已定 / 待定分开）** |
| §11 | C 组详细设计（状态模型、端点规格、推送、客户端、混版本兼容、测试矩阵） |
| §12 | D 组详细设计（仅轮询对账、对账算法、为什么不使用 NCS、§12.12 `publish_audio` 兜底、官方文档参考） |
| §13 | 客户端自检信号（官方核对结果、三层证明纪律、接进各组的改动、测试、边界、发版说明相关事实） |
| §14 | 文件落点与后续动作（本方案的摘要写到哪里） |
| 附录 | 明确不做的事 |

## 1. 先把问题说准

### 1.1 本项目的语音链路（音频从不经过我们的服务端）

```
[发言者浏览器] --采集/编码--> [声网 SDK + 边缘节点] --分发--> [其他浏览器]
        \                                                     /
         \--- 控制面：签发/撤回凭证、踢人/关房（频道管理 REST）---> [我们的 server/v2]
```

我们的服务端**只做控制面**（`voice/agora.ts` 签发 token、`server/v2/media.ts` 把身份映射成频道 uid 并调频道管理 REST）。因此"声音数据无法传输至服务端"要拆成两类缺陷：

| 类别 | 含义 | 典型成因 |
|---|---|---|
| **控制面失配** | 服务端以为已经收回/踢出，客户端其实还在发 | 踢人 REST 缺凭据 401 静默失败；发布凭证 TTL 在声网侧**不强制**（已实测） |
| **媒体面静默** | 客户端本地一切正常，但流没到别人那里 | 发布未真正生效、边缘/网络丢包、接收端订阅失败、接收端自动播放被拦 |

### 1.2 已核对的「假绿」清单（本地全绿、远端无人听到）

| # | 场景 | 客户端显示 | 依据（本次核对） |
|---|---|---|---|
| 1 | 自己的电平环来自**本地采集**，与"发布成功"无因果关系 | 麦开着、电平在动 | `web-v2/src/features/voice/session.ts:27` 注释即"本地采集，增益之后" |
| 2 | 中低丢包 / 分发异常但未触发质量事件 | 全绿，**零提示** | 只有 `exception`（2001/2002/2003/2005）才提示（`session.ts:39-47,154-159`） |
| 3 | 接收端 `subscribe()`/`play()` 失败 | 发送方全绿 | `session.ts:140-147` 的 `.catch(() => undefined)` 静默吞掉 |
| 4 | 房间内没有别的听众 / 别人被误踢 | 全绿 | 我们不知道频道里有谁（无成员核对） |
| 5 | 服务端要在窗口外收回权限，但踢人 REST 失败 | 继续发麦、全绿 | `server/v2/media.ts:19-22` 只 `console.warn('voice_service_unavailable')`；`install.sh/ps1` 不写客户密钥 → 401 |
| 6 | 发布凭证 TTL 到期 | **不提示、不掉麦**（声网侧不强制） | 2026-09-21 真机实测：20s 的 `pubAudio` 过期后仍能发麦 |
| 7 | 接收端把输出音量拖到 0 / 点静音 / 自动播放被拦 | 发送方全绿 | 只有接收端自己能看到「点击启用声音」（`bar.tsx:87`） |

### 1.3 现有信号覆盖到哪里

- **能看见**：取不到发布凭证/`publish()` 抛错（`microphoneError`，`session.ts:186,285`）；凭证过期与重连（`session.ts:152-153,240-251` + `bar.tsx:85`）；连接失败（`error` + 重试按钮）；音频质量异常码（`notice`）
- **看不见**：上面的 #1–#5、#7 —— 也就是"最像故障的那一类"
- **可见性打折**：`notice` 只在语音条渲染时出现（`bar.tsx:102`），离开对局页就看不到了

## 2. 目标 / 非目标

**目标（每条都可验收）**

- G1 本地麦克风无输入（静音设备/系统静音/选错设备）→ 本人 5 秒内在界面上看见
- G2 服务端媒体操作失败（踢人/关房）→ 管理端看得见计数与最近时间，不再只躺在容器日志里
- G3 发言窗口内「已确认收到」的接收端数量对**发言者本人**可见（C 组）
- G4 以上全部不依赖控制台「客户 ID/密钥」（D 组除外）
- G5 客户端能把三件事分开说清：**"我加入了频道"≠"我在发送音频"≠"采集到声音"**（§13 的自检信号）

**非目标（明确不做）**

- 不改 R-43 时段门控、不改"夜间全体静音且公屏禁发"、不加管理改判/新权限
- 不做服务端录音、混音、转码，不把音频改经我们自己的服务端转发（架构不变）
- 不做客户端之间私搭探测通道（不新增 P2P/WebRTC 直连）
- v1 客户端（`web/src/voice.tsx`）本期不纳入 C 组，只可选复用 A 组

## 3. 方案总览

| 组 | 内容 | 契约影响 | 依赖 | 相对工作量 | 建议版本 |
|---|---|---|---|---|---|
| **A** | 本地采集自检（无声音提示） | 无 | 无 | 小（前端 ~60 行 + 测试） | 可并入 `2.0.6-alpha` |
| **B** | 服务端静默失败显性化（管理端计数） | 无 | 无 | 小（服务端 ~40 行 + 测试） | 可并入 `2.0.6-alpha` |
| **C** | 端到端送达回执（发言者看到"N 人已确认收到"） | `PrivateGameDTO` 可选字段 + 新端点 + openapi/契约文档 | 无（不需要客户密钥） | 中（服务端 + v2 客户端 + 契约 + 夹具） | 独立版本（如 `2.0.7-alpha`） |
| **D** | 声网侧硬证据 → **详设见 §12**：只做 **D-a 轮询对账**（`queryChannelUsers` / `queryUserStatus`）；**不使用 NCS 事件回调（用户决定 2026-09-22）** | 不改契约；配套清理可选的 webhook/LiveKit 残留 | **客户 ID/密钥**（2026-09-23 用户改定「后续可以引入」）+ 区域 base URL | 中 | **已实现（2026-09-23，并入 `2.0.6-alpha`）**，待凭据到位后补验 |

> **§13 是横向能力层**：客户端自身可用的自检信号（`connectionState` / `uid` / `channelName` / `localTracks` / `getLocalAudioStats().sendBitrate` / `peerconnection-state-change` / `connection-state-change.reason`），被 A、B、C 三组复用，不单独构成一个版本。

## 4. A 组：本地采集自检（零契约，建议先做）

**主判据（推荐，§13 能力）**：`publish` resolve **且** `client.localTracks.length > 0` **且** `client.getLocalAudioStats().sendBitrate > 0` → 判定"**真的在往网络发**"。这比电平环硬一个量级：电平环量的是"本地采集"，`sendBitrate` 量的是"SDK 实际发出的音频流"。

**兜底判据（统计 API 不可用时）**：`requestMicrophone()` 成功（`publish` resolve，`session.ts:277-280`）后开一个判定窗口（默认 2 秒）；窗口内 `onVolumeIndicator`（200ms 一次，`VOLUME_INDICATOR_INTERVAL_MS`）收到的**自己**电平若始终 ≤ 阈值（默认 3/100）→ `state.microphoneSilent = true`，界面显示「未检测到麦克风声音：请检查系统麦克风或设备选择」；连续 3 个采样高于阈值后自动清除（防抖）。

**三种失败要分开显示（这是本组的核心价值）**

| 现象 | 判定 | 文案方向 |
|---|---|---|
| 采集不到声音 | 电平恒 0 且 `sendBitrate ≈ 0` | 「未检测到麦克风声音：检查系统麦克风或设备选择」 |
| 采集到但发不出去 | 电平正常但 `sendBitrate ≈ 0`（或 `peerconnection-state-change` 非 `connected`）；`publish()` 抛官方错误码 `NO_ICE_CANDIDATE`（本地网络出口被防火墙/插件阻断）或 `UNEXPECTED_RESPONSE` | 「麦克风有声音但未发送成功」＋按错误码给具体原因（网络出口/服务端拒绝） |
| 发送正常但没人听 | `sendBitrate > 0` 且订阅侧无回执 | 「已发送，等待接收确认」→ 交给 C 组 |

> 官方错误码映射（§13.7 第 6 条）：`mediaError()` 目前只处理麦克风权限类 `DOMException`，需补上 `NO_ICE_CANDIDATE` / `UNEXPECTED_RESPONSE` / `INVALID_OPERATION`（未加入就发布）三类，否则"发不出去"只能显示成通用失败文案。

**代码位置**：`web-v2/src/features/voice/session.ts`（窗口开始/累计/清除 + `getLocalAudioStats()` 轮询，`VoiceState` 增 `microphoneSilent: boolean` 与 `voiceFlow: 'idle'|'sending'|'blocked'`）、`web-v2/src/features/voice/bar.tsx`（渲染，建议新增 `voice-bar__warning` 而非复用 `voice-bar__hint`，与 notice 区分）。

**边界**：只在 `microphoneEnabled === true` 时判定；换设备、跨 AGC 阈值重建轨道、重连成功后**重开窗口**；不判定远端是否收到（那是 C 组的活）；阈值/窗口做成常量便于测试注入；`getLocalAudioStats()` 调用失败（老 SDK/权限）时静默退回电平判据。

**测试（先写预期，再看实现）**

- `tests/frontend-v2-voice-session.test.ts` +5 例：① 电平恒 0 且 sendBitrate 0 → `microphoneSilent` 为真；② 电平正常 → 始终为假；③ 从静音恢复有声 → 提示被清除；④ 电平正常但 `sendBitrate` 恒 0 → `voiceFlow === 'blocked'`（文案走"有声音但发不出去"）；⑤ `getLocalAudioStats()` 抛错 → 退回电平判据且不报错
- `e2e/specs-v2/18-voice-levels.spec.ts` +2 例：夹具分别把 `microphoneSilent` / `voiceFlow='blocked'` 置真，断言文案可见且与 `.voice-bar__hint` 不冲突（不需要真实设备）
- **回归有效性**：临时移除窗口判定与 sendBitrate 判定，上述对应用例必须变红

## 5. B 组：服务端把静默失败变响（零契约）

**机制**：`server/v2/media.ts` 的 `enqueue` 失败分支（现为 `console.warn`，`:19-22`）改为同时写入一个环形缓冲（最近 50 条：`at / gameId / op / 是否已重试`），并提供 `media.failureSnapshot()`；管理端汇总接口 `GET /api/v2/admin/summary`（`server/v2/admin-router.ts:99`；该路由组自 `admin-router.ts:67` 起统一要求管理员会话）增加 `voice: { failuresRecent: n, lastAt, lastOp }`。

**为什么不放公共 `/api/v2/diagnostics`**：该端点当前**没有鉴权**（`server/v2/app.ts:348`，只暴露房间数与连接数）；把媒体失败细节塞进去等于公开内部状态。若要给出一行公共计数，也只放"最近 24 小时失败次数"这类无身份信息的值（可选，默认不加）。

**已有基础（本分支已完成，不重复做）**：踢成功后才删映射 + 失败留待下次 `sync` 重试（`media.ts:41-50`）、`required` 时 `/voice/sync` 返回 503（`app.ts:347`）、REST 15s 超时 + 退避重试（`voice/agora.ts:140-165`）、发布 TTL 150 秒（`voice/agora.ts:66`）。

**配套的客户端侧（详见 §13）**：`connection-state-change` 的 `reason` 目前被丢弃（`session.ts:160-164` 只看 `curState`）——应与 B 组同时补上，让"被踢/token 过期/网络断"在界面上可分；`VOICE_EXCEPTIONS` 还漏了恢复码 `4005`（`RECV_AUDIO_DECODE_FAILED_RECOVER`，见 `session.ts:39-47`），一并补齐。

**测试**：`tests/v2-media.test.ts` +2 例（失败计数递增；成功后计数不误增/清零策略明确）；`tests/admin-api.test.ts` +1 例（summary 含 voice 失败字段、未登录不可见）。

## 6. C 组：端到端送达回执（唯一能证明"别人听到了"）

### 6.1 数据流

```
接收端 A：user-published(audio) → subscribe() → play() 成功
        └→ 每 1 秒最多 1 条（状态变化立即 1 条）POST /rooms/:code/voice/receipt
发言端 B：publish() 成功（服务端已在签发发布凭证时知道它应有发布权）
服务端  ：按 gameId + windowInstanceId 聚合 { delivered, blocked, silentOutput, failed }（Set 去重）
        └→ 私有视图 private.voice.delivery（仅发言者本人）→ 界面「已送达 11/12」
```

### 6.2 端点与安全

- `POST /api/v2/rooms/:code/voice/receipt`，body `{ requestId, gameId, windowInstanceId, speakerMediaId, state: 'playing'|'blocked'|'silent-output'|'failed', client?: { connectionState, peerConnectionState?, sendBitrate, remoteUsers } }`（`client` 为可选自检快照，见 §13；服务端只做诊断聚合，不据此授权）
- 与既有语音端点同样的前置：`intent(req)` + `limited(req,'voice',…)` + `directory.member(...)` + `requireMatch(...)`（对齐 `server/v2/app.ts:346-347`）
- **身份由服务端会话解析**（`meta.mediaId(playerId, epoch)`，`media.ts:51-61`），不接受客户端自报身份/uid；只接受"当前有发布权的身份"的收据，其余忽略
- 幂等：`requestId` 去重（复用 `OperationReceipts` 或 `Set<requestId>` 限长）

### 6.3 契约与文档

- `contracts/v2.ts`：`PrivateGameDTO`（`:69-75`）增加**可选**字段
  `voice?: { delivery: { windowInstanceId: string; speakerMediaId: string | null; delivered: number; blocked: number; silentOutput: number; failed: number; listeners: number; updatedAt: number } | null }`
  可选字段 = 向后兼容，老客户端不受影响；公共 `PublicGameDTO`（`:61-68`）**不加**
- `docs/openapi-v2.2.json`：新增端点 + **顺带修掉 `voice/token` 的 LiveKit 残留**（`:1878`/`:1929` 的 `roomName` 响应与 `:2104`/`:2234` 的 `livekitSignature`）
- `docs/client-contract-2.2.md`、`tests/fixtures/contract-2.1/` 重导出、`docs/frontend-v2-voice.md`、`docs/backend-v2-api.md` 同步

### 6.4 界面语义（措辞很重要）

| 服务端聚合 | 界面 | 含义 |
|---|---|---|
| `delivered > 0` | 「已送达 11/12」 | 有接收端确认在播 |
| `delivered == 0` 且已过 3 秒 | 「暂无人确认收到，请检查网络」 | 不写"未送达"，避免抖动误报 |
| `blocked > 0` | 「N 人未播放（对方需点击启用声音）」 | 浏览器自动播放限制，是可动作的提示 |
| `silentOutput > 0` | 「N 人已静音输出」 | 收到但对方听不到，属于对方偏好，不算故障 |
| 无发布权窗口 | 不显示该行 | 窗口结束即清零 |

### 6.5 隐私边界（必须守住）

- 只给**发言者本人**（私有视图）；公共视图不加字段；房主若要看，走管理端或后续单独提案
- 只给聚合数，**不暴露"谁收到了"**；`listeners` 数量级与房间公开成员列表同量级，不新增泄露面
- 仅在有发布权的窗口内采集与下发，窗口结束清零；**不写入复盘、公共历史、聊天或日志正文**
- 上报内容只有状态枚举，不含音频、不含设备标签、不含网络信息

### 6.6 测试

- 单测：`tests/v2-media.test.ts`（聚合、忽略无发布权身份、窗口切换清零、`requestId` 幂等）、新增 `tests/v2-voice-delivery-api.test.ts`（鉴权/校验/限流/非成员 403）、`tests/frontend-v2-voice-session.test.ts`（订阅成功后上报、`blocked` 上报、节流：1 秒内只发 1 条）
- 夹具 E2E：新增 `e2e/specs-v2/27-voice-delivery.spec.ts`（夹具驱动"已送达/无人确认/N 人未播放"三种渲染 + 不泄露到公共视图）；`18-voice-levels` 增 1 例保证旧界面不回归
- **真机**：扩展 `e2e/specs-v2/16-voice.spec.ts`——发言者页断言「已送达 ≥ 1」，接收方仍断言远端电平 > 0（现有断言，`16-voice.spec.ts:110-115`）。**这一步需要真实声网凭据**（见决策点 3）
- **回归有效性**：去掉服务端聚合或客户端上报，对应断言必须变红（沿用本分支的 stash 对照做法）

## 7. D 组：声网侧硬证据（暂缓；只做轮询）

> **详细设计见 §12**（状态目标 D1–D3、轮询路线、逐处改动、对账算法、测试矩阵、代价、以及"为什么不使用 NCS"）。下面是概要。

- 手段：**查询在线频道信息** REST——`GET /dev/v1/channel/user/{appid}/{channelName}`（全场）与 `GET /dev/v1/channel/user/property/{appid}/{uid}/{channelName}`（单个 uid：在否 + 角色 + 入频时间）；**官方只给在线状态，不给"是否在发流"**（见 §12.2 能力边界）
- **不使用 NCS / 消息通知服务与 Webhook 回调（用户决定 2026-09-22）**：轮询是唯一的服务端真相来源，代价是入频/离频的可见延迟 = 一个对账间隔（默认 5 秒）
- 前置成本：需要控制台「客户 ID/密钥」；与 2026-09-21 的决定（不再引入）冲突，因此**只作为将来选项**记录

## 8. 落地顺序与版本衔接

1. **阶段 1 = A + B**：零契约、可独立验收；同时落 §13.3 的客户端自检（A 组主判据、`reason` 文案、`4005` 补齐）；可并入当前 `2.0.6-alpha`，或另开 `2.0.7-alpha`
2. **阶段 2 = C**（详设 §11）：动契约（可选字段 + 新端点）+ §13.3-2 的回执自检快照；建议独立版本，先写预期测试与契约夹具，再写实现
3. **阶段 3 = D**（详设 §12）：前置是重新引入客户 ID/密钥 + 接通 `AGORA_REST_BASE_URL`；**只做轮询对账、不使用 NCS**；拿不到凭据就不启动，只保留 §12.10 的"软对账"作为过渡；若同时实测通过，可把 §12.12 的 `publish_audio` 封禁作为**异常兜底**（不是常规收权手段）
4. 每阶段收尾都要更新：`AGENTS.md`、`PROGRESS.md`、`theater_death_development_requirements_v1.1.md` 版本记录，以及三处计数（当前口径：`tests/` 92 文件 / 606 例、`e2e/specs-v2` 27 spec / 86 例）

## 9. 风险与代价

| 风险 | 说明 | 缓解 |
|---|---|---|
| C 组新增上报流量 | 每客户端 1 条/秒，仅在有发布权窗口内 | 只在窗口内上报 + 每客户端每分钟上限 60 条 + 服务端按 `mediaId` 去重 |
| 抖动误报 | 短暂丢包会让"已确认"数偏低 | 措辞用"暂无人确认收到"，不写"未送达"；3 秒观察窗 |
| 隐私 | 聚合数接近"在线听众数" | 房间成员列表本身公开；仅给发言者；夜间不采集 |
| 契约变更成本 | 需要契约夹具重导出与客户端契约文档同步 | 用**可选**字段（向后兼容）+ 单独版本 |
| 真机验证需要凭据 | C 组最有说服力的验收要真实声网项目 | 决策点 3；否则只能容器内假媒体验证（说服力弱，需在文档中标注） |
| 客户端自检被误当证据 | §13 的信号全部是客户端自证，可被改造/伪造 | 在文档与代码注释里明确"仅用于用户可见性，不作为授权或服务端判据"；服务端强制走 D 组 |

## 10. 决策清单（已定 / 待定）

**已定（无需再议）**

- **2026-09-21**：不引入客户 ID/密钥做验收（踢人/关房真实 REST 与 v1 `02-voice` 不跑）；接受「连麦鉴权未生效」风险 → 缓解 = 服务端签发/撤回（依赖客户端 `renewToken`）+ 发布凭证 TTL 150 秒
- **2026-09-23（改定上一条）**：**后续可以引入客户 ID/密钥**（用户决定）→ D 组轮询对账、踢人/终局关房的真实 REST 与 v1 `02-voice` 转为**待凭据到位后补验**；随带待办：install 脚本生成的 `.env` 补客户 ID/密钥、接通 `AGORA_REST_BASE_URL`
- **2026-09-22**：**不使用 NCS / 消息通知服务与 Webhook 回调**，D 组只做轮询对账（§12.5）；`publish_audio` 封禁**只作兜底**，不做常规麦位管理（§12.12）
- **2026-09-22**：声网官方来源**有且仅有** `https://doc.shengwang.cn/` 与官方 MCP Server（顶部核对表；已同步写入 `AGENTS.md`）

**待定（请确认后才动手）**

1. **范围**：只做 A+B（零契约、见效快），还是直接做到 C（端到端证明）？
2. **C 组可见性**：只给发言者本人（本方案默认），还是也给房主/公共聚合数？
3. **C 组真机验收**：为它临时/长期重新引入声网凭据跑一次 `16-voice` 扩展（最有力），还是只在容器内用假媒体验证（不动凭据）？
4. **版本落点**：A+B 并入 `2.0.6-alpha`，还是另开 `2.0.7-alpha` 走独立提案/PR？
5. **D 组是否重启凭据**：**已定案并执行（2026-09-23，用户改定「后续可以引入客户 ID/密钥」）**——凭据落本机 `.env`，对账计数、踢未知 uid、踢人/关房真实 REST 与 v1 `02-voice` 均已补验，实测结论见 §12.13。
6. **D 组配套清理**：是否顺手删掉 `docs/openapi-v2.2.json` 的 `livekitSignature` 残留与 `server/v2/app.ts:98` 的死路由（既然确定不做回调）？
7. **D 组对账间隔**：默认 5 秒；是否改用 3 秒（更灵敏、QPS 仍充裕）或 10 秒（更保守）？
8. **是否把 `publish_audio` 作为兜底启用**（§12.12）：官方不支持用它做常规麦位管理，只能作异常补偿；启用需真机实测（是否立即停发、是否影响收听、解封时延）
9. **A 组主判据**（§13.3-1）：是否接受为 `getLocalAudioStats()` 增加约 1 秒轮询（用于 `sendBitrate` 判定），还是只用现有电平判据（改动更小，但分不清"没采集到"与"采集到但发不出去"）？
10. **是否在界面暴露网络质量与断连原因**（§13.3-3/4）：如 `network-quality >= 4` 显示"网络差"、被服务端踢出时明确提示；也可先只写日志不打扰玩家

---

## 11. C 组详细设计（端到端送达回执）

### 11.1 服务端状态模型

```ts
// 建议落在 server/v2/media.ts（与 identities 同级），随对局结束/关房清理
type ReceiptState = 'playing' | 'blocked' | 'silent-output' | 'failed';
interface DeliveryWindow {
  windowInstanceId: string;                 // 发言窗口的 WindowDTO.instanceId（contracts/v2.ts:41）
  speakerMediaId: string;                   // 发言者的服务端媒体身份（meta.mediaId(...)）
  startedAt: number;
  receipts: Map<string, ReceiptState>;      // key = 接收端 mediaId（服务端解析，不信客户端）
  lastPushAt: number;
}
// V2Media 内：private readonly deliveries = new Map<string /*gameId*/, DeliveryWindow>();
```

- **建窗**：`issue()` 在 `canPublish === true` 分支（`media.ts:99-108`）发现"当前发言窗口键 ≠ 已记录窗口键"→ 丢弃旧窗、建新窗（**每个窗口一份，不保留历史**）
- **窗口键来源**：`gameView(...)` 里的 `windows` 中发言类窗口（`election_speech`/`speech_round`/`last_words`/`tie_speech`）取 `instanceId`——与客户端 `bar.tsx:66` 用的是同一份清单，避免两边判定漂移
- **清窗**：① 窗口键变化；② `permissions()` 中该身份不再有发布权；③ `meta.room.state.win`（对局结束，随 `closeRoom` 一起删）；④ 房间解散/暂停
- **聚合**：`delivered = receipts 中 playing|silent-output 的条数`、`blocked`、`failed` 分别计数、`listeners = receipts.size`（**分母是"报告过的接收端数"**，不是频道人数——避免误导，见 11.5 风险）

### 11.2 端点规格

```
POST /api/v2/rooms/:code/voice/receipt
Cookie: 账号会话（与其它 v2 端点一致）
Body:   { requestId, gameId, windowInstanceId, state,                        // 不接受任何身份字段
          client?: { connectionState, peerConnectionState?, sendBitrate, remoteUsers } }   // 可选自检快照（§13）
200 →   { recorded: true,  delivery: { windowInstanceId, delivered, blocked, silentOutput, failed, listeners, updatedAt } }
200 →   { recorded: false }        // 窗口已过期/不匹配：静默忽略，不报错（老客户端/慢请求友好）
409 voice_disabled | 403 room_access_required / authorization_changed | 409 voice_unavailable
400 invalid_request_payload | 429 rate_limited
```

- **前置链**与 `app.ts:346-347` 同构：`intent(req)` + `limited(...)` + `directory.member(room, s)` + `requireMatch(room, matchId(req))`
- **身份只由服务端解析**：`meta.resolve(session)` → `viewer.mediaIdentity`；body 里的未知字段一律丢弃（符合"客户端只能提交意图"约束）
- **限流**：新桶 `limited(req, 'voice-receipt', 60, 60_000)`（每会话每分钟 60 条，正好覆盖"每秒 1 条"的客户端节流）
- **幂等**：`requestId` 进 LRU（256 条/房），重复请求直接回上次结果
- **只接受当前窗口**：`windowInstanceId !== 当前窗口键` → `recorded: false`（不产生错误、不计入聚合）

### 11.3 视图与推送（避免快照风暴）

- 契约（`contracts/v2.ts`，`PrivateGameDTO` 增**可选**字段，向后兼容）：
  ```ts
  voice?: { delivery: { windowInstanceId: string; delivered: number; blocked: number; silentOutput: number; failed: number; listeners: number; updatedAt: number } | null } | null;
  ```
- 组装点：`server/v2/view.ts` 的 `gameView(...)` 私有分支 + `server/v2/snapshots.ts:113` 组装 `RoomSnapshot` 时注入；**公共 `PublicGameDTO` 不加任何字段**
- 推送：收据写入后**不逐条 `refresh`**。规则：计数发生变化 且 距 `lastPushAt` ≥ 1000ms 才调一次 `hub.refresh(gameId)`；`server/v2/realtime.ts:26-43` 本身已有 microtask 合并 + 逐 socket 指纹去重，1 帧/秒的开销可接受（13 人的房间约 1 帧/秒，而非 13 帧/秒）
- 服务端把 `startedAt/updatedAt` 基于 `clock.now()`（假时钟可控，便于测试）

### 11.4 客户端（v2）

- `session.ts`：新增 `#reportDelivery(state)`，触发点：
  - `user-published`(audio) → `subscribe()` + `play()` 成功 → `playing`；抛错 → `failed`（**同时取消现有的 `.catch(() => undefined)` 静默吞**，`session.ts:140-147`）
  - `audioBlocked === true` → `blocked`（用户点「点击启用声音」后补报 `playing`）
  - 本地输出音量为 0 或已静音偏好 → `silent-output`（本地判定，不上报音量值）
  - 节流：同一 `windowInstanceId` 内状态未变时每 1 秒最多 1 条；状态变化立即 1 条；离开/关麦/换局即停
  - **前置门槛**：只有 `client.connectionState === 'CONNECTED'` 才上报（未加入/重连中不上报，避免把"我没连上"写成"我收到了"）；上报时附带 §13 的自检快照 `{ connectionState, peerConnectionState, sendBitrate, remoteUsers }`
  - `connection-state-change` 的 `reason`（仅 `DISCONNECTED` 时给）要读出来：`BANNED_BY_SERVER` → 提示"已被服务端移出语音"（与 §12.12 的 `publish_audio` 封禁联动），token 类 → 自动续期/重连，网络类 → 走既有重连路径
- `bar.tsx`：`state.microphoneEnabled` 时在音量行下方显示一行（无 `listen` 数据时不显示）：
  - `delivered > 0` → 「已确认收到 11/12」
  - `delivered === 0 && listeners > 0 && 距开麦 ≥3s` → 「暂无人确认收到，请检查网络」
  - `blocked > 0` → 「N 人未播放（对方需点击启用声音）」
  - `silentOutput > 0` → 「N 人已静音输出」
- v1（`web/src/voice.tsx`）**本期不做**；服务端对"没有回执的客户端"保持兼容（见下）

### 11.5 混版本兼容（关键，决定会不会误报）

| 组合 | 行为 |
|---|---|
| 服务端新 + 客户端新 | 正常显示 |
| 服务端新 + 客户端旧（v1 或旧 v2） | `listeners === 0` → **不显示送达行**（不出现"0 人确认"的假警报） |
| 回滚服务端（字段消失） | 客户端读不到 `private.voice.delivery` → 整行不显示（可选字段 + 前端容错） |

- 只要收到过任意一条合法收据，就把该房标记为 `supportsReceipts`；这是"是否显示该行"的唯一开关
- `listeners` 的语义必须在 UI 文案里体现为"报告中的接收端"，不写成"频道人数"

### 11.6 测试矩阵（先写预期）

| 层 | 文件 | 用例 |
|---|---|---|
| 聚合 | `tests/v2-media.test.ts` | +5：建窗/清窗、无发布权身份的回执被忽略、窗口键变化清零、`requestId` 幂等、对局结束清空 |
| 端点 | 新增 `tests/v2-voice-delivery-api.test.ts` | +6：无会话 401、非成员 403、`voice_disabled` 409、未知窗口 `recorded:false`、限流 429、成功返回聚合且**忽略伪造身份字段** |
| 视图 | `tests/v2-api.test.ts` + 契约夹具校验 | +2：私有视图含 `voice.delivery`；**公共视图不含任何 voice 字段** |
| 客户端 | `tests/frontend-v2-voice-session.test.ts` | +4：订阅成功上报、`audioBlocked` 上报 blocked、1 秒内只发 1 条、离开后停止 |
| UI | `tests/frontend-v2-voice-levels.test.ts` | +2：四种文案；`listeners === 0` 时不渲染 |
| 夹具 E2E | 新增 `e2e/specs-v2/27-voice-delivery.spec.ts` | +3：已送达 / 暂无人确认 / 未播放提示；并断言公共面板不出现该行 |
| 真机 E2E | `e2e/specs-v2/16-voice.spec.ts` | +1：发言者页「已确认收到 ≥1」（**需要真实凭据**） |

- **回归有效性**：去掉服务端聚合 → 端点/视图用例必须红；去掉客户端上报 → 夹具 E2E 必须红（沿用本分支 stash 对照做法）

### 11.7 契约与文档同步清单

`contracts/v2.ts`（可选字段）→ `docs/openapi-v2.2.json`（新端点；**顺带修 `voice/token` 的 LiveKit 残留**：`:1878`/`:1929` 的 `roomName`、`:2104`/`:2234` 的 `livekitSignature`）→ `docs/client-contract-2.2.md` → `tests/fixtures/contract-2.1/` 受控快照（由 `tests/contract-openapi.test.ts` 逐夹具校验，需按现有做法同步）→ `docs/frontend-v2-voice.md` / `docs/backend-v2-api.md`。

### 11.8 风险

| 风险 | 缓解 |
|---|---|
| 快照风暴 | 计数变化 + 1 秒节流再 `refresh`；复用 `realtime.ts` 的合并与指纹去重 |
| 分母误导 | `listeners` 只统计"报告过的接收端"，文案照此措辞 |
| 抖动误报 | 3 秒观察窗 + "暂无人确认"措辞 |
| 老客户端假警报 | `listeners === 0` 时不显示该行 |

---

## 12. D 组详细设计（声网侧硬证据：**仅轮询对账**）

> **已定决策（用户，2026-09-22）：不使用 NCS / 消息通知服务与 Webhook 回调。** 因此本组只保留**轮询对账（D-a）**；NCS 的调研结论移到 §12.5 备查，避免将来重复评估。
>
> ✅ **官方站已核对（2026-09-22，唯一来源 `https://doc.shengwang.cn/`）**：
> - **频率上限**：对**每个声网账号**（非每个 App ID），"查询在线频道信息"类 API **20 次/秒**，其他 API **10 次/秒**（来源：[`/doc/rtc/restful/quota`](https://doc.shengwang.cn/doc/rtc/restful/quota)）
> - **封禁/踢人接口的用法、语义与超时要求**：见 §12.12（来源：[`/doc/rtc/restful/best-practice/user-privilege`](https://doc.shengwang.cn/doc/rtc/restful/best-practice/user-privilege)）
>
> ⚠️ **仍待核对（仅这两个接口）**：内容来自非官方英文站 `docs.agora.io` / `api-ref.agora.io`。已尝试用官方 MCP 语料核对，但 `get-doc-content` 对这两个 operation 返回 `not found`（**查询类接口不在 MCP 语料里**；`kicking-rule` 系列在语料中，已核对，见 §12.12），官方站对应页又是 JS 渲染，因此**实施前需人工在浏览器打开确认字段名**：
> - **查询用户状态**：`GET https://api.agora.io/dev/v1/channel/user/property/{appid}/{uid}/{channelName}`，Basic 认证，`uid` **只支持数字**（不支持字符串账号）。响应 `data`：`in_channel`(bool，为 `false` 时**不返回其他字段**)、`uid`(number)、`join`(**Unix 秒**)、`role`(0 未知 / 1 通信频道用户 / 2 直播主播 / 3 直播观众)、`platform`(1 Android / 2 iOS / 5 Windows / 6 Linux / **7 Web** / 8 macOS / 0 其他)；示例 `{"success":true,"data":{"join":1640330382,"uid":2845863044,"in_channel":true,"platform":7,"role":2}}`
> - **查询用户列表**：`GET https://api.agora.io/dev/v1/channel/user/{appid}/{channelName}`（可选 `hosts_only`，仅直播场景）。响应 `data`：`channel_exist`(bool，为 `false` 时不返回其他字段)、`mode`(1 COMMUNICATION / 2 LIVE_BROADCASTING)，以及 **`mode=1` 时的 `total` 与 `users[]`（纯数字 uid 数组）**；`mode=2` 时改为 `broadcasters[]` / `audience[]`(前 1 万) / `audience_total`。该站明确推荐：**同步频道在线统计用列表接口**（频率更低、效率更高）——正好支持我们"每轮 1 次全场查询"的设计
> - **能力边界（重要，与来源无关）**：这两个接口只回答**在线 / 角色 / 入频时间**，**不能**回答"是否正在发流"；且本项目客户端用 `mode: 'rtc'`（COMMUNICATION 场景），用户列表**不区分主播/观众**。所以 **D 组只能保证"在线与权限对齐"，"是否真的在传"仍必须靠 C 组**
> - 取数说明：加 `.md` 后缀可拿到该英文站的 OpenAPI 原文（`/en/api-reference/api-ref/rtc/query-user-status.md`、OpenAPI 文件 `/openapi/rtc/channel-management.en.yaml`）——**取数方便，但按上述约定不算官方来源**

### 12.1 目标

- **D1** 服务端能回答"某 uid 现在是否真的在频道里"（不依赖客户端自报）
- **D2 对账（reconcile）**：定期比对"服务端认为应有的状态"与"声网侧真实状态"，修复两类差异——**应在而不在**（未入频、掉线、被踢）、**不应在而在**（回收失败、旧凭证重进）
- **D3 强制力**：把「连麦鉴权未生效」的兜底从"客户端自觉"升级为"服务端强制"——用**方案②（失去发布权即踢 uid）**的自动化；`publish_audio` 封禁可作为**异常路径的兜底**（官方不支持用作常规麦位管理，见 §12.12）

### 12.2 路线（只保留轮询）

| 路线 | 手段 | 时延 | 前置 | 风险 |
|---|---|---|---|---|
| **D-a 轮询对账（采用）** | `GET https://api.agora.io/dev/v1/channel/user/{appid}/{channelName}`（全场用户，每轮 1 次）/ 诊断时用 `…/user/property/{appid}/{uid}/{channelName}`（单用户：是否在频道 + 角色 + 入频时间） | **一个对账间隔**（默认 5 秒，见 §12.3） | 客户 ID/密钥 + 区域 base URL | 官方限流；需按房间排班；**查不到"是否在发流"** |
| ~~D-b 事件回调（NCS）~~ | ~~消息通知服务推送 101–112 频道事件~~ | — | — | **用户决定不使用（2026-09-22）**，调研结论见 §12.5 |

轮询失败可独立降级（查询失败不阻塞游戏）；不使用回调后，部署面不再需要公网可达的回调地址、签名密钥与 IP 白名单。

### 12.3 逐处改动清单

1. **`voice/agora.ts`**
   - 新增 `queryChannelUsers(channel, options)`：`GET /dev/v1/channel/user/{appid}/{channelName}`；诊断用单用户版 `queryUserStatus(channel, uid)`：`GET /dev/v1/channel/user/property/{appid}/{uid}/{channelName}`。两者都用 `AbortSignal.timeout`（复用现有 15s）+ 与 `isRetryable` 一致的退避（`:81,140-165`）；4xx 不重试
   - **接通 `restBaseUrl`**：选项已存在（`:46`）但服务端从不传，默认恒为 `https://api.sd-rtn.com`（`:57,104`）→ 全球区项目用 `https://api.agora.io`，需要它
   - 不新增签名校验函数（既不走回调，就不需要 NCS 专用密钥）
2. **`server/v2/index.ts`**：读 `AGORA_REST_BASE_URL` 并传入；**凭据不全时降级**（`voiceEnabled` 但 `admin: false` / `reconcile: false`）并在日志/管理端显式提示，而不是静默或崩溃（审计 ②）
3. **`server/v2/app.ts`**：**保持现状**——`/api/v2/voice/webhook` 与 `verifyWebhook` 钩子继续不注入（既然不用 NCS，就没有回调要处理）；残余的 LiveKit 形态字段可作为独立清理项处理（见 §12.3 第 9 条）
4. **`server/v2/media.ts`**：新增 `reconcile(meta)`；与现有 `sync()` 的分工——`sync()` 是**状态驱动**（应答式，谁不该有权限就踢谁），`reconcile()` 是**定时对账**（拉真实频道状态兜底）
5. **调度**：挂到既有维护循环 `server/v2/maintenance.ts`；**默认 5 秒一轮**（不使用回调后，轮询是唯一的服务端真相来源，间隔比原方案的 10 秒收紧；可按 QPS 预算调到 3–10 秒），**仅在有对局、且在 R-43 允许语音的时段**执行；对同一轮次加抖动，避免多房间同时打点
6. **配置与部署**：
   - `deploy/install.sh` / `install.ps1` 生成 `AGORA_CUSTOMER_KEY` / `AGORA_CUSTOMER_SECRET` / `AGORA_REST_BASE_URL` 模板（审计 ④；**不需要** NCS 密钥）
   - `deploy/compose.v2.release.yml` 注入 `AGORA_*`（审计 ③）
   - `deploy/RUNBOOK.md` §7 补：区域 base URL（中国 `api.sd-rtn.com` / 全球 `api.agora.io`）、**20 次/秒/账号**的频率预算与对账间隔建议、**客户端域名白名单**（v4.24.5 起：`*.agora.io`、`*.edge.agora.io`、`*.sd-rtn.com`、`*.edge.sd-rtn.com`、`*.rtnsvc.com`、`*.edge.rtnsvc.com`、`*.rtesvc.com`、`*.edge.rtesvc.com`，见 §13.7 第 4 条）；**不需要**回调地址、签名密钥与 IP 白名单
7. **可观测**：管理端 `/api/v2/admin/summary` 增 `voice: { reconcile: { lastAt, mismatches, kicks, failures } }`；公共 `/api/v2/diagnostics`（无鉴权，`app.ts:348`）**不加**细节
8. **频率预算**：20 次/秒是**整个账号**共享的上限（"查询在线频道信息"类 API），一场对局一轮 = **1 次全场查询**（不用单用户查询，除人工诊断）→ 5 秒一轮约 0.2 QPS/房间，理论上可同时支撑上百个对局房间；踢人走"其他 API"的 10 次/秒桶。管理端暴露 429（被限流）次数，超阈值时自动退避到 10 秒/轮
9. **顺带清理（可选，与"不使用 NCS"配套）**：`docs/openapi-v2.2.json` 里 `voice/webhook` 的 `livekitSignature` 残留与 `server/v2/app.ts:98` 的死路由，既然确定不做回调，建议一并删除，避免以后被误认为"系统有回调能力"。此条属清理，不含行为变更

### 12.4 对账算法（伪码）

```
期望 = permissions(meta)                    // Map<mediaId, canPublish>（media.ts:51-61）
真实 = queryChannelUsers(gameId)            // 已核对的响应：data.channel_exist / data.mode / data.users[]（mode=1）
若 !data.channel_exist 且 期望非空:        → 记 channel_missing（该局频道没人/已销毁）
若 data.mode !== 1:                        → 记 reconcile_mode_mismatch 并本轮跳过（我们用 rtc=COMMUNICATION）
真实集合 = new Set(data.users)
for uid in 真实集合:
    if uid ∉ identities 反向映射:  → 未知 uid（旧凭证/异常入频）→ kick
for (mediaId, canPublish) in 期望:
    uid = identities[mediaId]
    if uid ∉ 真实集合:              → 记 not_in_channel（应在线却不在：未加入、掉线或被踢）
                                    → 可选：给该玩家语音条下发一条 notice 提示
    if uid ∈ 真实集合 and not canPublish: → kick（D3：窗口外仍占频道 → 强制回收）
每轮 kick 上限 N（默认 3）；两次对账间隔内不重复 kick（沿用"踢成功才删映射"的语义，media.ts:41-50）
单用户查询（诊断用）：in_channel=false 时不返回其他字段，因此按"字段存在性"解析，不要假设 join/role 一定有
查询失败 → 记 reconcile_unavailable，不抛给游戏（媒体失败不改变胜负、不暂停计时）
```

- **明确的能力边界**：`not_in_channel` 只能证明"人不在频道"，**不能**证明"在频道但没在传音频"——后者官方 REST 查不到，只能由 C 组的端到端回执回答。两者组合起来才完整：**D 说"人在不在"，C 说"声音到没到"**
- 若查询接口将来返回角色信息，可与 `canPublish` 交叉校验（直播场景下观众=不可发布）；本项目是 COMMUNICATION 场景，该维度暂不可用

### 12.5 为什么不使用 NCS（调研备查）

**用户决定（2026-09-22）：不使用 NCS / 消息通知服务。** 本组只做轮询对账。以下为已核对的 NCS 事实与取舍，留档以免将来重复评估：

| 维度 | 事实（官方文档，2026-09-22 核对） |
|---|---|
| 传输 | 仅 HTTPS POST；需 **10 秒内回 200 + JSON**，否则立即重试、间隔递增、**最多 3 次** |
| 签名 | `Agora-Signature`（HMAC/SHA1）/ `Agora-Signature-V2`（HMAC/SHA256），密钥是**控制台 Webhook 页签生成的专用密钥**（非 App Certificate、非客户密钥） |
| 事件 | 101 创建 / 102 销毁 / 103 主播加入 / 104 主播离开 / 105 观众加入 / 106 观众离开 / 107 通信模式加入 / 108 通信模式离开 / 111 观众转主播 / 112 主播转观众；**没有发布/取消发布事件** |
| 离开原因 | `reason`：1 正常 / 2 超时 / 3 被 REST 踢出 / 10 网络 / 12 token 错误或过期 / 999 异常用户（官方要求 60 秒内补踢） |
| 开通成本 | 控制台自助开通 + **必须通过健康检查**；防火墙需 `GET https://api.agora.io/v2/ncs/ip` 白名单并 24 小时刷新 |

**放弃它的代价（本方案接受）**：

1. **入频/离频从"亚秒级事件"变成"一个轮询间隔后可见"** → 无凭证入频的踢出延迟由 <1 秒变为 ≤5 秒（对"踢人不拉黑、清位"的语义无实质影响）
2. **拿不到 `reason` 码** → 无法区分"被我们踢出 / token 过期 / 网络掉线"，只能看到"不在线了"；对 D3 的回收动作无影响（动作只依赖权限与在线状态）
3. **丧失"频道销毁"事件** → 终局关房本来就由我们自己调用 `closeRoom`（`media.ts:71-73`），因此无功能缺口

**换来的收益**：不需要公网可达回调地址与证书、不需要控制台开通 NCS 与健康检查、不需要签名密钥与 IP 白名单维护、不引入第二条状态通路（更少的一致性分支）。

### 12.6 隐私边界

- 频道查询**只服务端内部使用**：不向任何客户端暴露"谁在频道里"
- 审计明细沿用既有粒度（不含语音内容、不含设备信息）
- 与 C 组的边界：C 组给发言者的是聚合数；D 组连聚合数都不给客户端（内部对账）

### 12.7 测试与验收

| 层 | 文件 | 用例 |
|---|---|---|
| 声网适配 | `tests/voice-agora.test.ts` | +7：全场查询成功/超时/5xx 重试/4xx 不重试、单用户查询命中与未命中（角色+入频时间）、区域 base URL 生效、签名校验正反例 |
| 对账 | `tests/v2-media.test.ts` | +6：未知 uid 踢出、`not_in_channel` 只记不踢、该回收即踢、一致时零动作、查询失败降级、每轮 kick 上限 |
| 调度 | 新增 `tests/v2-voice-reconcile-loop.test.ts` | +4：仅在有对局且语音时段跑、5 秒节拍（假时钟）、429 后退避、房间销毁即停 |
| 管理端 | `tests/admin-api.test.ts` | +1：summary 含 reconcile 计数与限流次数 |
| 真机 | 扩展 `16-voice` | ① 发言者发布后全场查询可见其 uid；② 用旧的订阅凭证加入一个"不该在"的 uid → 下一轮对账后应被踢出（**需要客户密钥**） |

- **回归有效性**：关闭对账循环，② 的断言必须变红
- **不可测的部分要写明**：官方 REST 查不到"是否在发流"，因此"人在频道里但音频没传出去"这类故障**只能由 C 组的回执覆盖**，D 组测试不得声称覆盖它

### 12.8 代价（必须写清的取舍）

- **与既有决定的关系（更新）**：需要引入并使用控制台「客户 ID/密钥」；2026-09-21 曾决定"不再引入"，**2026-09-23 用户已改定「后续可以引入客户 ID/密钥」**，本节的取舍不再与此冲突，剩下的只是执行时点与 `.env` 落点
- **配额（已核对）**：官方对**每个账号**限制"查询在线频道信息"类 API **20 次/秒**、其他 API **10 次/秒**（踢人也算"其他"→ 10 次/秒）；一场对局一轮 1 次全场查询，5 秒一轮 ≈ 0.2 QPS/房间，配额不是瓶颈；仍要监控 429 并自动退避
- **部署面（不使用 NCS 后显著简化）**：无需公网可达回调地址、无需控制台开通消息通知与健康检查、无需签名密钥与 IP 白名单；只需在 `.env` 配客户 ID/密钥 + 区域 base URL
- **收益**：D 是唯一能在"客户端不配合、掉线、或说谎"时仍然成立的对齐手段；「连麦鉴权」若将来开启，D3 会自动变成冗余保险

### 12.9 与 C 的关系与推荐顺序

- **C 解决"用户可见"**（说话的人知道自己有没有被听到），**D 解决"服务端强制"**（不依赖客户端）
- 推荐顺序：**C 先做**（不依赖凭据、用户价值直接）；**D 在拿到客户密钥且需要强保证时再做**；C + D3 叠加即完整实现既有文档中的"方案②"

### 12.10 若坚持不引入客户密钥的替代做法（及其局限）

- 以 C 的回执做"软对账"：窗口内 `delivered === 0 且 listeners > 0` → 服务端主动 `revoke` 该身份（只降权 + 要求客户端 `renewToken`）
- **局限**：声网侧不强制权限位（已实测），因此这仍依赖客户端配合，**不能替代 D**——这正是「连麦鉴权未生效」已接受风险的复述，写在这里以免被误当作等价方案
- **但注意 §12.12**：引入客户密钥后，除对账外还能用 `publish_audio` 封禁强制收回发麦——官方要求它**只作兜底**（不做常规麦位管理），但仍比"软对账"硬；这属于引入凭据后的额外收益

### 12.11 官方文档参考（2026-09-22 核对）

**本方案采用（轮询对账）**

- 查询用户列表（全场，`hosts_only` 仅直播场景）：[docs.agora.io/en/api-reference/api-ref/rtc/query-user-list](https://docs.agora.io/en/api-reference/api-ref/rtc/query-user-list)
- 查询用户状态（单个 uid：在否 + 角色 + 入频时间）：[docs.agora.io/en/api-reference/api-ref/rtc/query-user-status](https://docs.agora.io/en/api-reference/api-ref/rtc/query-user-status)
- 频率配额（账号级：查询类 20 次/秒，其他 10 次/秒）：[doc.shengwang.cn/doc/rtc/restful/quota](https://doc.shengwang.cn/doc/rtc/restful/quota)

**已评估、决定不采用（NCS 消息通知，留档备查）**

- 频道事件类型（101–112 与 payload 字段）：[doc.shengwang.cn/doc/rtc/restful/webhook/events](https://doc.shengwang.cn/doc/rtc/restful/webhook/events)
- 接收与验证 Webhook（签名头、10 秒/200、重试三次、控制台开通与健康检查）：[doc.shengwang.cn/doc/rtc/restful/webhook/receive_webhook](https://doc.shengwang.cn/doc/rtc/restful/webhook/receive_webhook)
- 英文版同一主题：[docs.agora.io/en/realtime-media/rtc/build/optimize-and-operate/receive-notifications](https://docs.agora.io/en/realtime-media/rtc/build/optimize-and-operate/receive-notifications)

**AI/OpenAPI 原文入口（本轮发现的可用取数方式）**

- `https://docs.agora.io/en/api-reference/api-ref/rtc/query-user-status.md`、`…/query-user-list.md`、`…/create-ban-rule.md`（加 `.md` 后缀即得 OpenAPI 原文；同源中文页正文由 JS 渲染、抓取不到）
- OpenAPI 文件：`/openapi/rtc/channel-management.en.yaml`；文档索引：`/llms.txt`

### 12.12 服务端可以**强制禁止发麦**——但官方明确要求只当兜底

官方站已逐字核对（[`/doc/rtc/restful/best-practice/user-privilege`](https://doc.shengwang.cn/doc/rtc/restful/best-practice/user-privilege)，页面标题「封禁用户权限」）：`privileges` 有三个值，我们此前只用了一个。

| privileges | 官方用法（原文要点） |
|---|---|
| `join_channel` | **一次性踢出频道**：填 `cname` + `uid`、不填 `ip`、**`time: 0`**（"不封禁，只是下线一次，用户可以重新登录进入频道"）——与我们现有实现一致 ✅ |
| `join_channel` + 仅 `cname` | **解散频道**：不带 `uid`、`time: 0`——与我们 `closeRoom` 一致 ✅ |
| **`publish_audio` / `publish_video`** | **封禁发流权限**：填 `uid`、不填 `cname`/`ip`、**`time` 必须为 `0` 以外的值**；官方场景是"发现用户已经下麦或没有发流权限却仍能发流"时的兜底 |

**这确实能补上"连麦鉴权未生效"的强制力**：即使控制台开关不生效、客户端不配合 `renewToken`、发布凭证 TTL 在声网侧不被强制，服务端仍可用 `publish_audio` 真正收回发麦能力。

**但官方同时给了两条硬约束，本方案必须遵守**：

1. **不推荐用封禁接口做麦位管理**（官方「不适用场景」第一条原文）："用户下麦时封禁发流权限，用户上麦时解封"被点名为**不适用**，理由是"RTC 业务逻辑依赖封禁 API 的可用性，如解封失败则用户无法发流"。
   → 因此 **本项目 R-43 每轮开麦/收麦的主流程不能用它**；它只能作为**兜底**：即"窗口已结束、客户端仍拿着旧凭证发麦"这种异常路径的补偿，且封禁时长要短。
2. **封禁是危险操作**（官方原文）："应当作为业务信令通知用户下麦失败，且造成实际影响之后的兜底手段"，并要求考虑解封延迟/失败对用户再次发言的影响、"封禁的时长尽量设置短一些"。

**修正后的建议用法**

- 主流程（每轮收权）保持现状：服务端签发/撤回 token + 客户端 `renewToken` + 发布 TTL 150 秒兜底
- 兜底（异常时才动）：发现发言者窗口已结束仍在发麦 → ① 先踢（既有 `join_channel` + `time:0`，让它重新进频道拿订阅凭证）；② 若反复出现，再对该 uid 施加**短时** `publish_audio` 封禁（如 `time_in_seconds: 30`），并在下一次授予发言权前**主动解封**
- **决策点 9 相应调整为**："是否把 `publish_audio` 作为**兜底**启用"（而不是常态收权手段）

**对现有实现的核对结论（`voice/agora.ts:132-139`）**：`appid` 在请求体 ✅、`time: 0` + `join_channel` ✅、注释里的"一次性踢出可能失败需重调"与官方一致 ✅；因此**无需修正**。

**必须先实测确认（需要客户密钥）**：

1. 对**正在发布**的 uid 施加 `publish_audio` 封禁，是否**立即**停止其发流
2. 该封禁是否影响该 uid 的**订阅/收听**（若影响，就不能对听众使用）
3. 解封（`time: 0` 取消规则 / DELETE 规则）的时延与失败表现
4. Web 端被封禁时的回调表现（官方站只说明了 `join_channel` 场景下 SDK 会进入 `DISCONNECTED`（含"被声网服务器踢出频道"），`publish_audio` 的回调需实测）

**官方站的其它硬性要求（与我们现有实现相关）**：客户端**请求超时建议 ≥20 秒（最低不低于 5 秒）**，5xx/超时可退避重试——我们当前 REST 单次超时 **15 秒**（`voice/agora.ts` 的 `DEFAULT_REST_TIMEOUT_MS`），**做兜底封禁前应上调到 ≥20 秒**；`time≠0` 的规则**必须保存返回的 `id`** 才能后续删除/改期（`time:0` 无需保存）；查询类请求优先级低于写请求，网络差时查询的成功率与准确性会下降（对账要容忍）。*（字段级细节如 `time_in_seconds` 的取值范围来自非官方站，标 ⚠️ 待官方站复核。）*

### 12.13 实测记录（2026-09-23，真实账号 + 真实频道；探针用完即删）

引入客户 ID/密钥后对本节的两个关键假设做了真机核对，**结论与原假设不符，已按实测改写实现**：

| 假设（原计划） | 实测结果 | 处理 |
|---|---|---|
| 关房用官方「不带 uid 的踢人规则」即可踢出频道内所有人 | **不成立**：对空频道与有人频道都返回 `{"status":"success","id":0}`，**频道内一个用户都不少**、`GET /dev/v1/kicking-rule` 的 `rules` 为空——静默空操作（修复前：调用 6 秒后频道仍是 `[4,5]`） | `closeRoom` = 官方调用 **+ 按频道实况逐个补踢**（上限 50）+ 复查，残留打 `voice_close_room_incomplete`；补踢后同一场景频道变 `[]` |
| 单 uid 踢人可用 | **成立**：踢 555001 后其离开频道、同频道 555002 仍在 | 保持 |
| 对账查询可用 | **成立**：假时钟按 6 秒推进时 `rounds` 0→4→8→16→24、`failures` 0、干净进程 `notInChannel` 0 | 保持；失败时补打 `voice_reconcile_query_failed <原因>` |
| 对账能踢"我们不认识的 uid" | **成立**：用 App 证书自签 `uid=0` 通配凭证让浏览器以 uid 987654 入频道 → 下一轮对账踢出，`unknownKicks` 递增 | 保持（只踢未知 uid，听众不误伤） |
| `AGORA_REST_BASE_URL` 留空即用默认值 | **不成立（服务端）**：`?? undefined` 对空串无效 → REST 基地址变成空串 → 相对 URL → 查询/踢人/关房**全部失败**，表现为「对账只涨 `failures`、`rounds` 恒 0」 | 适配器与两个入口都改为「空/空白/尾斜杠一律按未配置处理」（compose 的 `${VAR:-默认}` 本来就会兜住空串，服务端此前没有） |

配套部署面（同批修复）：install 脚本生成的 `.env` 补 `AGORA_CUSTOMER_KEY/SECRET`、`AGORA_REST_BASE_URL`、`ADMIN_PASSWORD`；主 `docker-compose.yml` 此前**没有注入 `ADMIN_PASSWORD`**（管理后台按文档设置也永远打不开）、`compose.v2.release.yml` 只注入 `VOICE_ENABLED` — 均已补；`VOICE_ENABLED=true` 但缺 App ID/证书时改为**降级为「文字测试模式」**并告警（不再拒绝启动，与 v1 一致）。

## 13. 客户端可用的自检信号（横向能力层，A/B/C 复用）

### 13.1 客户端自检信号（Web SDK NG；本项目依赖 `agora-rtc-sdk-ng@^4.24.8`，官方站当前最新亦为 v4.24.8）

**✅ 已在官方站逐字核对**

| 信号 | 官方站原文要点 | 出处 |
|---|---|---|
| `AgoraRTCClient.connectionState` | 官方明确提供该**字段**获取当前连接状态；五个取值 `DISCONNECTED` / `CONNECTING` / `CONNECTED` / `RECONNECTING` / `DISCONNECTING`；`CONNECTED` = "用户已经加入频道，可以在频道内发布或订阅媒体轨道" | `/doc/rtc/javascript/basic-features/channel-connection` |
| `AgoraRTCClient.on("connection-state-change")` | 状态改变时触发，"**并在回调中明确当前的连接状态和发生状态改变的原因**"；官方给出 10 秒不发音视频包 → 远端 `user-unpublished`、20 秒无心跳 → 远端 `user-left` 的时序 | 同上 |
| `DISCONNECTED` 的含义 | 含"**被声网服务器踢出频道**或者连接失败等异常情况"——把"被踢"与"网络断"分开的官方依据 | 同上 |
| `client.join(...)` **返回 uid** | 官方示例 `const uid = await client.join("APPID","CHANNEL","TOKEN")`；不传 `uid` 时声网自动分配 **Number 型** uid（本项目正是数字 uid） | `/doc/rtc/javascript/basic-features/join-leave-channel` |
| `leave()` 会**销毁连接状态对象** | "调用 `leave` 后，SDK 会立刻销毁与当前频道相关的对象，包括订阅的远端用户对象、远端轨道对象、记录连接状态的对象" | 同上 |
| **`getLocalAudioStats()` / `getLocalVideoStats()`** | 官方原文：分别获取本地发布的音频/视频轨道统计数据（说明见 `LocalAudioTrackStats` / `LocalVideoTrackStats`） | `/doc/rtc/javascript/advanced-features/in-call-quality` |
| **`getRTCStats()`** | 获取当前通话统计数据（见 `AgoraRTCStats`） | 同上 |
| `getRemoteAudioStats()` / `getRemoteVideoStats()` | 远端轨道统计，含 `end2EndDelay` / `receiveDelay` / `transportDelay` 字段说明 | 同上 |
| **`on("network-quality")`** | 加入频道后 SDK **每 2 秒**触发，报告本地上下行 Last mile 网络质量打分；打分表 0–6（**6 = 完全无法沟通**） | 同上 |
| `getRemoteNetworkQuality()` | 获取已订阅远端用户的上下行网络质量打分 | 同上 |
| `on("exception")` | 报告频道内异常事件（`code` / `msg` / `uid`），恢复正常时同样收到回调 | 同上 |
| **调用时机约束** | 官方原文："上述所有方法必须在成功加入频道之后调用" ← 支持 C 组"只在 `CONNECTED` 时上报/判定"的设计 | 同上 |
| `publish` 语义 | 同一时间只能发布 1 个视频轨道；可发布多个音频轨道并由 SDK 自动混音；不能重复发布同一轨道对象 | `/doc/rtc/javascript/basic-features/publish-subscribe` |
| 订阅链路语义 | `user-published` → `subscribe` → `user.audioTrack.play()`；远端取消发布时 SDK 自动释放 `RemoteTrack`，无需手动 `unsubscribe` | 同上 |

**客户端属性与统计（官方 API 参考，已用 MCP 的 `get-doc-content` 逐条核对）**

| 信号 | 官方原文要点（来源：`docs://api-reference/rtc/javascript/interfaces/iagorartcclient` 等） |
|---|---|
| `client.channelName?: string` | "当前加入的频道名称。**如果本地用户没有加入频道，该属性值为 `undefined`**"（Optional + Readonly） |
| `client.uid?: UID` | "本地用户的用户 ID。**如果本地用户没有加入频道，该属性值为 `undefined`**"（Optional + Readonly） |
| `client.connectionState: ConnectionState` | "SDK 和声网服务器的连接状态"（Readonly；取值见 §13.1 第一张表） |
| `client.localTracks: ILocalTrack[]` | "保存当前正在发布的本地轨道对象列表"（Readonly，**4.0.0 起**）；`publish` 成功后自动加入、`unpublish` 成功后自动移除 |
| `client.remoteUsers: IAgoraRTCRemoteUser[]` | "远端用户信息列表…**如果本地用户没有加入频道，该列表为空**"（Readonly） |
| `getLocalAudioStats(): LocalAudioTrackStats` | 方法存在；返回结构字段：**`sendBitrate`＝"发送的音频码率 (bps)"**、`sendBytes`＝发送的音频总字节数、`sendPackets`＝发送的音频总包数，另有丢包率/抖动字段 |
| `getRTCStats(): AgoraRTCStats` | 字段：`Duration`（在当前频道内的时长，秒）、`UserCount`（**通信场景下＝当前频道内用户人数**）、`SendBitrate`（音视频总发送码率 bps，瞬间值）、收发字节数（累计值） |
| `peerconnection-state-change` | 官方 API 参考有该事件条目："自从 **4.23.0** 本地媒体连接 PeerConnection 的状态回调"，参数 `curState` / `revState`（`RTCPeerConnectionState`）；发版说明同时提到新增全局版 `AgoraRTC.on("peer-connection-state-change")` |

> 落地纪律不变：即便已核对，仍按"能力探测 + 兜底"实现（API 不存在或抛错时自动降级，不得让语音功能不可用）。

### 13.2 三层证明不可互相替代（本方案的核心纪律）

| 层次 | 能证明什么 | 手段 |
|---|---|---|
| **客户端自证** | 我的 SDK 连上了边缘、我的轨道在发 | §13 这些信号（可被改造/伪造） |
| **服务端事实** | 频道/声网侧是否真的把我算在内（`in_channel`）、谁不该在 | D 组 `queryChannelUsers` / `queryUserStatus`（§12） |
| **对端事实** | 别人是否真的解出并播放了我的声音 | C 组端到端回执（§11） |

因此 `connectionState === 'CONNECTED'`、`sendBitrate > 0` 都**不能替代** C/D；反过来 C/D 也无法告诉用户"你的麦克风其实没声音"——三者互补，缺一不可。

### 13.3 接进各组的 4 处（本节不单独排版本）

1. **A 组**：以 `sendBitrate` 为主判据、电平为兜底，把"没采集到"与"采集到但发不出去"分开（§4）
2. **C 组**：回执带 `{ connectionState, peerConnectionState, sendBitrate, remoteUsers }`，且**只在 `CONNECTED` 时上报**（§11.2 / §11.4）——服务端据此能区分"客户端根本没连上"与"连上了但没人收到"
3. **B 组配套**：读出 `connection-state-change` 的 `reason`（`BANNED_BY_SERVER` / token 类 / 网络类），让界面文案与实际原因对齐（§5）
4. **补齐**：`VOICE_EXCEPTIONS` 增加 `4005`（`RECV_AUDIO_DECODE_FAILED_RECOVER`，`session.ts:39-47` 目前漏了）；可选加 `network-quality >= 4` 的"网络差"提示
5. **错误码文案**（官方错误码，§13.7）：把 `NO_ICE_CANDIDATE` / `UNEXPECTED_RESPONSE` / `INVALID_OPERATION` 映射成具体提示，替代现在的通用失败文案
6. **可选体验增强**（需单独评估）：v4.24.6 起的 `autoReceiveAndPlayAudio` 可缩短"入会后听到声音"的等待，但必须与 `audioBlocked`「点击启用声音」提示一起回归（自动播放策略仍在）

### 13.4 测试

- 单测（`tests/frontend-v2-voice-session.test.ts`）：`isJoined()` 三条件（`connectionState` / `uid` / `channelName`）、`reason = BANNED_BY_SERVER` 的文案分支、`4005` 清提示；`sendBitrate` 判定见 §4 的用例
- 夹具 E2E（`18-voice-levels`）：`voiceFlow='blocked'` 与"网络差"文案渲染；回执快照字段用夹具断言（不需要真机）
- 真机（需凭据，与 C 组同一批）：`16-voice` 断言发言者 `sendBitrate > 0` **且**接收方远端电平 > 0（两个方向同时成立才算通）

### 13.5 边界（写清以免被当护身符）

- 全部是**客户端自证**：改造过的客户端可以撒谎，所以**服务端判定与强制**（D 组对账、`publish_audio` 封禁）不能被它们替代
- `connectionState` / `peerconnection-state-change` 只到本地传输层：**不代表 SFU 已把流分发给了别人**
- `sendBitrate` 为 0 也可能是"用户静音/真没说话"——必须与电平判据交叉，不可单独报错
- `getLocalAudioStats()` 在部分环境（老 SDK、权限受限）可能不可用，必须有兜底路径（§4 的兜底判据）

### 13.6 依据来源

**官方站（唯一权威来源 `https://doc.shengwang.cn/`）+ 官方 MCP Server `https://doc-mcp.shengwang.cn/mcp`**

- **MCP Server**（工具 `search-docs` / `list-docs` / `get-doc-content`，语料即官方文档）——本轮用它核对完了 §13.1 的**全部**客户端 API 条目与字段：
  - `docs://api-reference/rtc/javascript/interfaces/iagorartcclient`（属性 `channelName` / `uid` / `connectionState` / `localTracks` / `remoteUsers`，方法 `getLocalAudioStats`，事件 `peerconnection-state-change`）
  - `docs://api-reference/rtc/javascript/interfaces/localaudiotrackstats`（`sendBitrate` / `sendBytes` / `sendPackets`）
  - `docs://api-reference/rtc/javascript/interfaces/agorartcstats`（`Duration` / `UserCount` / `SendBitrate`）
  - `docs://api-reference//rtc/restful/channel-management/operations/post-dev-v1-kicking-rule`（`privileges` 三值与过滤规则）
- [文档指引（JS/Web）](https://doc.shengwang.cn/doc/rtc/javascript/landing-page)——Web SDK 文档结构与入口
- [频道连接状态管理](https://doc.shengwang.cn/doc/rtc/javascript/basic-features/channel-connection)——`connectionState` 字段、`connection-state-change` 回调（含原因）、五个状态与断线重连时序 ✅
- [加入和离开频道](https://doc.shengwang.cn/doc/rtc/javascript/basic-features/join-leave-channel)——`join` 返回值与数字 uid、`leave` 的销毁语义、join 错误码（含 `UID_CONFLICT`）✅
- [发布和订阅](https://doc.shengwang.cn/doc/rtc/javascript/basic-features/publish-subscribe)——`publish`/`unpublish`/`subscribe` 语义与错误码（含 `NO_ICE_CANDIDATE`）✅
- [通话中质量监测](https://doc.shengwang.cn/doc/rtc/javascript/advanced-features/in-call-quality)——`getRTCStats` / `getLocalAudioStats` / `getRemoteAudioStats` / `network-quality` / `exception`，以及"必须在成功加入频道后调用"✅
- [发版说明](https://doc.shengwang.cn/doc/rtc/javascript/overview/release-notes)——当前最新 v4.24.8、`autoReceiveAndPlayAudio`、autoplay 恢复修复、域名白名单变更 ✅
- [客户端 API 参考](https://doc.shengwang.cn/api-ref/rtc/javascript/interfaces/iagorartcclient.html)——上述条目在官网的对应页面（本环境经 MCP 读到同一份语料）

**非官方站（仅供查阅参考，不作为实施依据）**

- `docs.agora.io` 英文站与 `api-ref.agora.io`——**仅剩**查询类 REST 接口的字段级 schema 依赖它们（见顶部核对状态表）

### 13.7 官方站（发版说明 / 发布订阅）另外查到的相关事实

来源：官方站 [`/doc/rtc/javascript/overview/release-notes`](https://doc.shengwang.cn/doc/rtc/javascript/overview/release-notes)、[`/doc/rtc/javascript/basic-features/publish-subscribe`](https://doc.shengwang.cn/doc/rtc/javascript/basic-features/publish-subscribe)、[`/doc/rtc/javascript/basic-features/join-leave-channel`](https://doc.shengwang.cn/doc/rtc/javascript/basic-features/join-leave-channel)。

1. **版本**：官方站当前最新为 **v4.24.8（2026-08-31，"进行了一些内部改进"）**；本项目依赖 `agora-rtc-sdk-ng@^4.24.8`，与官方最新一致（此前文中引用的 "v4.24.1" 是非官方英文站 API 参考的版本号，已更正）
2. **`autoReceiveAndPlayAudio`（v4.24.6 新增，默认关闭）**：开启后用户加入频道时 SDK **自动接收并尝试播放远端音频**，用于"入会后尽快听到声音"的场景。可评估启用以缩短入会听声延迟；但必须与我们的 `audioBlocked`「点击启用声音」提示一起测（自动播放策略仍在）
3. **v4.24.6 修复了与我们直接相关的问题**："使用 WebAudio 播放远端音频时，部分浏览器在自动播放受限后，用户完成交互仍可能无法恢复声音" → 我们的 `enableAudio()` 手动恢复路径在新版已受益；官方同时提示**首次播放音频仍可能需要用户点击/触摸**
4. **v4.24.5 起域名白名单变更（部署项）**：`*.agora.io`、`*.edge.agora.io`、`*.sd-rtn.com`、`*.edge.sd-rtn.com`、`*.rtnsvc.com`、`*.edge.rtnsvc.com`、`*.rtesvc.com`、`*.edge.rtesvc.com`——有防火墙的网络环境需放行；应写入 RUNBOOK 的部署检查项（与 D 组 REST 用的 `api.sd-rtn.com` / `api.agora.io` 同源）
5. **`join` 官方错误码**：`INVALID_PARAMS`（参数非法，如 token 格式错）、`INVALID_OPERATION`（重复加入频道）、`OPERATION_ABORTED`（join 成功前调用了 leave）、`UNEXPECTED_RESPONSE`（**App ID 或 Token 鉴权失败**，如开启 App 证书却未传 Token）、**`UID_CONFLICT`**（多个 `AgoraRTCClient` 复用同一 uid）
   → `UID_CONFLICT` 为"v1 客户端 uid = 座位号、多标签页会冲突"这条风险提供了**官方依据**（本分支已如实记录该遗留项）
6. **`publish` 官方错误码**：`INVALID_OPERATION`（**未加入频道就发布**）、`OPERATION_ABORTED`、`INVALID_LOCAL_TRACK`、`CAN_NOT_PUBLISH_MULTIPLE_VIDEO_TRACKS`、`NOT_SUPPORTED`、`UNEXPECTED_RESPONSE`、**`NO_ICE_CANDIDATE`**（找不到本地网络出口：防火墙或禁用 WebRTC 的插件）
7. **`subscribe` 官方错误码**：`INVALID_OPERATION`、`INVALID_REMOTE_USER`、`REMOTE_USER_IS_NOT_PUBLISHED`、`UNEXPECTED_RESPONSE`、`OPERATION_ABORTED`、`NO_ICE_CANDIDATE`
8. **`peerconnection-state-change` 的出处（v4.23.0，2024-12-19）**：发版说明原文"为获取媒体连接的实时状态变化，该版本新增 `peerconnection-state-change` 事件，用来获取 WebRTC `RTCPeerConnection` 的连接状态"，并**同时新增全局版 `AgoraRTC.on("peer-connection-state-change")`**
9. **同版本的另一条与我们相关**：v4.23.0 改进了媒体重连策略（"提升了弱网情况下 SDK 的重连和媒体登录成功率，对于部署了防火墙的企业网络提升尤为明显"），但**需联系声网技术支持开通**——如果线上出现弱网/企业防火墙下的"发不出去"，这是可选项

**对本方案的直接影响**：A 组的「有声音但发不出去」分支应把 `NO_ICE_CANDIDATE` / `UNEXPECTED_RESPONSE` / `INVALID_OPERATION` 映射成具体文案（现在 `mediaError()` 只处理麦克风权限类 `DOMException`）；`autoReceiveAndPlayAudio` 与域名白名单分别作为"体验可选增强"和"部署检查项"（见 §4、§12.3 第 6 条）。

## 14. 文件落点与后续动作

### 14.1 本方案各部分的落脚点

| 内容 | 放在哪 | 状态 |
|---|---|---|
| 方案本体（问题定位、四组方案、详设、决策点） | 本文件 `docs/proposal-voice-delivery-observability.md` | ✅ 已写完（未提交） |
| 一页摘要 | 本文件 §0 | ✅ |
| 实施后的行为说明 | `docs/frontend-v2-voice.md`（客户端可见行为）、`docs/backend-v2-api.md`（新端点/字段） | 待实现后补 |
| 契约（C 组） | `contracts/v2.ts` + `docs/openapi-v2.2.json` + `docs/client-contract-2.2.md` + `tests/fixtures/contract-2.1/` | 待实现后改 |
| 部署检查项（D 组） | `deploy/RUNBOOK.md` §7、`deploy/install.sh`/`install.ps1`、`deploy/compose.v2.release.yml` | 待实现后改 |

### 14.2 项目记录里的「一句话总结」（建议稿，尚未写入）

按项目惯例（改动须更新版本记录），方案立项时应在下面三处各加一句。**这三处属于受控记录，仍需你确认后我才写**：

1. **`PROGRESS.md`（进度与交接，接续工作先读）**
   - 状态表新增一行：`| 2.0.7-alpha（声网语音可观测性，提案 kiahir） | ⏳ 待批准 | A+B 零契约、C 动契约、D 需凭据；不使用 NCS；方案见 docs/proposal-voice-delivery-observability.md |`
   - 「接续指引」加一句指向该方案文件
2. **`AGENTS.md`（当前进度）**：在 v2.0.6-alpha bullet 之后追加一条提案 bullet（一句话 + 指向方案文件 + 明确"未实现、待批准"）
3. **`theater_death_development_requirements_v1.1.md`（文末版本记录）**：追加「###（提案，未实现）声网语音可观测性」小节（问题 / 四组 / 决策点 / 不变量），实现落地时再升级为正式版本记录

### 14.3 提交建议

- `docs: 新增语音送达可观测性方案（提案，含声网官方 MCP 核对结论）` → 本文件
- `docs: AGENTS 增补声网官方文档与 MCP Server 核对规则` → `AGENTS.md`（已改，未提交）
- 实现阶段按 §8 分阶段提交：阶段 1 = A+B+§13 客户端自检；阶段 2 = C；阶段 3 = D

## 附：本方案明确不做的事

- 不把音频改为经我们服务端中转，不做录音/混音/转码/字幕
- 不改 R-43 门控与夜间静音；不新增"谁能听谁"的权限模型
- 不新增管理改判、踢人拉黑、公开匹配等能力
- 不在公共视图放任何"某人是否在听/是否开麦"的字段
- 不引入第三方监控 SDK（沿用容器日志 + 管理端汇总）
- **不把客户端自检（§13）当作服务端证据或授权依据**：它只用于"让用户看见自己的状态"，服务端判定一律走 D 组对账与声网侧能力
- 不使用 NCS / 消息通知服务与 Webhook 回调（用户决定 2026-09-22，§12.5）
