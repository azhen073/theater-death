# 白天「自由发言」阶段（Q-11）验收记录

规则变更（用户裁定 Q-11，2026-09-23）：规则 2.0 新增**可选**的「白天自由发言」阶段，房主建房时显式选择是否开启。本文记录规则与裁定、逐层实现、验证命令与结果、未覆盖项。

## 1. 规则与裁定

| 项 | 内容 |
| --- | --- |
| 规则出处 | 1.1 规则书 R-41 括注 + 第 09 章追加 **Q-11**；2.0 合并版 `docs/rules-v2-full.md` R-41 / R-43；差异条目 `docs/rules-v2.md` **V2-06**（覆盖 R-41 顺序与 R-43 语音许可） |
| 用户裁定 | ① 形态 = **全体开麦式**（不是轮流）；② 位置 = **发言轮之后、放逐投票之前**；③ 房主**必须显式选择**、**无默认值**；④ **每个白天都有**；⑤ 追加要求：该阶段**照常下发送达回执**、**「谁在说话」座位光环一起做** |
| 位置 | 每个白天：`morning_announcement → first_night_last_words → election（仅首日）→ speech_round → ★free_speech → vote → elimination_last_words → handover → settle` |
| 时长 | 固定 **120 秒**（`timersSeconds.freeSpeech = 120`）。**不提前结束**——与夜间窗口同一口径：固定时长是防泄露设计，不由「无事可做」缩短 |
| 语音许可 | 全体**存活**玩家同时可发布（`canPublishVoice === true`），死者仍只可订阅（遗言之外）；没有「当前发言者」，`autoMic` **不**自动开麦；夜间语音不受影响（R-43 仍全体静音） |
| 送达回执 | 照常下发。多发布者并发时按**窗口 + 发布者集合**聚合，发布者**自己的**回执不计入 |
| 座位光环 | 由**本机**远端电平判定「谁在说话」，与「当前发言者」无关；带保持期（见 §2 `voice-levels`） |
| 开关落点 | 冻结在**本局规则**（`timersSeconds.freeSpeech`），不是房间策略：房主选 `true` → 保留 `freeSpeech: 120`；选 `false` → 从 timers 中**删除该键**，引擎侧门控 = `freeSpeechSeconds(state) !== null` |
| 边界 | 1.1 命名预设与 **v1 入口没有该阶段**（正式预设比对忽略这个房主可选键）；实验模式板沿用默认值 |

## 2. 逐层实现

**规则层**

- `rulesets/types.ts`：`TimersSeconds.freeSpeech?: number`。
- `rulesets/theater-death-13-v2.ts`：`timersSeconds.freeSpeech = 120`。
- `rulesets/validate.ts`：计时器白名单加 `freeSpeech`；新增 `withoutFreeSpeech(config: unknown)`，**正式预设比对时先剥掉该键再深比较**（否则房主选「不开启」会撞 `formal_preset_mismatch`）；同时保留一道守卫——被篡改的 `freeSpeech` 取值仍按 `invalid_timer` 拒绝。

**引擎层（纯规则）**

- `engine/types.ts`：`DayStep` 加 `'free_speech'`；`DayContext.freeSpeechDone?: boolean`（防止天理移交后重走发言轮时**重复**插入一次自由发言）。
- `engine/day.ts`：`freeSpeechSeconds(state)`（读冻结的 timers，`null` = 未开启）、`enterFreeSpeechOrVote()`（发言轮最后一位结束 → 开启则进 `free_speech`、否则直接进投票）、`freeSpeechIssue()`（未开启时拒绝推进并给出原因）、`advanceFreeSpeech()`；`advanceSpeech()` 的最后一个发言者改为调用 `enterFreeSpeechOrVote()`。
- `server/day-driver.ts`：`DayWindowId` 加 `'free_speech'`；`openNext()` 对应分支 `scheduleWindow('free_speech', timers().freeSpeech ?? 120, timeoutFreeSpeech)`；`timeoutFreeSpeech()` 推进引擎。

**语音层**

- `voice/policy.ts`：`case 'free_speech'` → 死者 `dead_listener`，其余 `granted()`（即全体存活可发布）。
- `server/v2/media.ts`：`SPEAKING_WINDOWS` 加 `'free_speech'`；`DeliveryWindow.speakerMediaIds: readonly string[]` + `sameSpeakers()`——送达聚合从「单一发言者」改成「发布者集合」，窗口内集合不变即同一聚合；`currentWindow()` 返回**全部**发布者；`recordReceipt` 拒绝**任何**发布者自己的回执；新增 `uidMap(gameId)`（解析 `v2:<gameId>:<subject>:<epoch>`，只收 `p_` 主体）供前端把频道 uid 映射回玩家。

**快照与 HTTP**

- `server/v2/snapshots.ts`：`freeSpeechEnabled(room)`；`RoomSnapshot.room.freeSpeech`；公开视图新增 `voice: { uids: uidMap(gameId) }`（仅对局中有值）。
- `server/v2/app.ts`：`POST /rooms` 校验必填布尔 `freeSpeech`，缺失或非布尔 → 400 `invalid_free_speech`；为 `false` 时构造 timers 时删除 `freeSpeech` 键；快照依赖注入 `uidMap`。
- `contracts/v2.ts`：`DayStep` 加 `'free_speech'`、`DayDTO.step` 联合类型、`PublicGameDTO.voice?: { uids: Record<string, string> } | null`、`room.freeSpeech: boolean`。
- `docs/openapi-v2.2.json`：`timersSeconds.freeSpeech`、`Day.step` 枚举加 `free_speech`、`room.freeSpeech`（必填）、`/rooms` 请求体 `freeSpeech` 必填、`PublicGame.voice`。

**前端（web-v2）**

- `presentation/labels.ts`：`publicPhaseLabel` 的 `'free_speech'` → 「自由发言」。
- `presentation/voice-levels.ts`：`SPEAKING_LEVEL_THRESHOLD = 5`、`SPEAKING_HOLD_MS = 1200`、`activeSpeakingSeats(held, levels, uids, now)`——按电平阈值 + 保持期算出「正在说话」的玩家集合，未知 uid 忽略。
- `features/voice/speaking-seats.ts`（新增）：模块级存储 + `subscribeSpeakingSeats` / `updateSpeakingSeats` / `clearSpeakingSeats` / `useSpeakingSeats`，带 `schedulePrune()` 定时器（采样停止后仍要在保持期结束时清光环）。
- `features/voice/session.ts`：`#levels` 采样 + `onLevels()` 订阅，teardown 时清空。
- `features/voice/bar.tsx`：`SPEAKING_WINDOW_IDS` 加 `'free_speech'`（可手动开麦），`TURN_WINDOW_IDS` **不含**它（`autoMic` 早退：自由发言没有「轮到我」，且没有当前发言者时也不自动开麦）；状态行「自由发言进行中 · 全体存活可开麦」；把远端电平写进座位光环存储。
- `features/game/stage.tsx` + `scene.tsx`：座位带 `data-player-id`，`liveSpeakingPlayerIds` → `stage-seat--speaking` + `.seat-speaking`（「正在发言」标签）。
- `features/game/speech-attention.tsx`：自由发言阶段显示「自由发言进行中 · 全体存活可同时开麦」，并挂 `role="timer"` 的剩余时间（名称「自由发言剩余时间」）。
- `features/room/create.tsx`：新增必选「自由发言：开启 / 不开启」单选（`role="radiogroup"`；未选时提交按钮禁用并提示「请先选择是否开启白天自由发言」），请求体带 `freeSpeech`。
- `features/room/lobby.tsx`：「本局规则」显示「白天自由发言：开启（发言轮后 2 分钟 · 全体存活可开麦）/ 不开启」。

## 3. 验证（2026-09-23，容器内）

**单测（增量，`node scripts/test-incremental.mjs`）**

| 文件 | 新增/相关用例 |
| --- | --- |
| `tests/v2-free-speech.test.ts`（新增） | 4 例：关闭时发言轮直接进投票；开启时发言轮后进 120 秒窗口、截止才投票；只走一次（天理移交重走发言轮不重复）；未开启时拒绝推进并给出原因 |
| `tests/v2-timers.test.ts` | +1 例：开启后发言轮走完插入 120 秒窗口，截止才进入放逐投票 |
| `tests/v2-media.test.ts` | +1 例：自由发言多名发布者同时有效、送达按窗口聚合、任何发布者自己的回执都不算 |
| `tests/v2-api.test.ts` | +1 例：建房必须显式选择并冻结进规则（缺字段/非布尔 400 `invalid_free_speech`，`true` 保留 120 秒、`false` 删除键） |
| `tests/frontend-v2-voice-levels.test.ts` | +1 例：按远端电平判定「谁在说话」，带保持期且忽略未知 uid |
| `tests/contract-openapi.test.ts` + 契约夹具 | `Day.step` / `room.freeSpeech` / `/rooms` 必填 / `PublicGame.voice` 与文档同步；`tests/fixtures/contract-2.1/*.json` 10 个 `RoomSnapshot` 补 `"freeSpeech": false` |

批次结果：**34 文件 284 例全过**（`frontend-v2-*` 21 文件 170 例 + 引擎 / 驱动 / 语音 / 媒体 / 契约 / API）。静态清点：`tests/` **95 文件 668 例**、`e2e/specs-v2` **31 spec / 102 例**。

**四个 typecheck**：`typecheck`（服务端 + tests）、`typecheck:web`（v1 未改动，一并验证）、`typecheck:web:v2`、`typecheck:web:v2-tests` 全部 exit 0。

**E2E（acceptance 栈 + seed，容器内 Playwright，双浏览器）**

| spec | 结果 | 覆盖 |
| --- | --- | --- |
| `specs-v2/30-free-speech.spec.ts`（新增，2 例） | **4 passed**（chromium 2 + webkit 2） | ① HUD 阶段名「自由发言」、提醒条文案、`role="timer"` 倒计时；语音条「自由发言进行中 · 全体存活可开麦」、**不自动开麦**、手动开麦后「已送达 1/1」；电平 42 → 对应座位亮光环「正在发言」、归零后保持期内仍在、之后消失（4 秒内清掉）。② 建房表单：未选时提交禁用 + 两个单选 `aria-checked=false` + 提示；选中后请求体 `{ publicChat: 'alive_only', freeSpeech: true }`；大厅显示「白天自由发言：开启（发言轮后 2 分钟 · 全体存活可开麦）」 |
| 回归 `specs-v2/18-voice-levels` + `22-speech-attention` + `05-information` | **26 passed** | 既有发言者电平、发言聚焦条、情报页签未被光环/阶段变更破坏 |
| 回归 `specs-v2/02-rooms` | **6 passed**（跳过既有 presence 失败用例） | 建房表单新增必选字段后其余必填项校验不变 |
| 回归 `specs-v2/06-chat-screen-real` | **2 passed**（跳过依赖手动时钟的用例） | 真实服务端聊天与阵营房边界不变 |

截图（全屏 `fullPage`，本地产物，不入库）：`test-results-frontend-v2/free-speech-speaking-{chromium,webkit}.png`（自由发言阶段 + 座位光环 + 送达回执）、`free-speech-lobby-{chromium,webkit}.png`（大厅开关展示）。

## 4. 未覆盖 / 已知项

- **真实声卡下的多人同时开麦未验**：需要真实声网凭据与多路麦克风；本批由 `v2-media` 单测（多发布者许可 + 回执聚合）与 E2E 的**夹具远端电平**覆盖界面链路，未做真机双端互听。
- **没有「自由发言提前结束」**：这是刻意设计（与夜间窗口同一防泄露口径），不作为缺失项；如将来要加需重新开裁定号。
- **v1 入口没有该阶段**（1.1 预设），因此 v1 E2E 未跑；本次未改 `server/legacy-*` 与 `web/`。
- 未跑全量 Vitest / 全量 E2E，未重建发布镜像，未部署；分支 `2.0.7-alpha` 本地未推送。
