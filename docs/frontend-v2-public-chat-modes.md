# Web v2 公屏写权限档位（全阶段可写）验收记录

规则变更（用户裁定 Q-10，2026-09-23）：公屏文字由「仅白天」改为**对局内所有阶段可写**，写权限范围由房主在建房时于两个档位中显式选择。本文记录实现范围、验证命令与结果、未覆盖项。

## 1. 规则与契约

| 项 | 内容 |
| --- | --- |
| 规则 | 1.1 规则书 R-35 表 + 第 09 章追加 **Q-10**；2.0 板 `docs/rules-v2-full.md` R-35 表；差异条目 `docs/rules-v2.md` **V2-05**（覆盖 R-35 的公屏发送时段，并覆盖 S2 阶段「夜间公屏禁发」的原裁定） |
| 档位 | `alive_only`＝仅存活正式玩家可写（死者只读，本人获准遗言期间仍可写）；`everyone`＝存活与死者全体可写。**无默认值**，`POST /api/v2/rooms` 缺字段或取值非法 → 400 `invalid_public_chat`；创建后不可修改 |
| 复现字段 | `RoomSnapshot.room.publicChat`；`capabilities.canPostPublic` 仍为唯一写权限信号 |
| 边界 | 观众与第二屏在任何档位下只读；大厅与复盘不适用（复盘按 R-53 只读归档）；**夜间语音不变**（R-43 全体静音）；**v1 入口维持「仅白天」旧行为**（已知不对称） |
| 「公开生死」口径 | 能力一律由已公开状态推导：夜间被击杀但**尚未晨间公告**的玩家，本人视角仍显示存活，因此此刻仍可发言（否则等于用发言权限泄露死讯）；公告后即按档位拒绝。`tests/chat-receipts-api.test.ts` 明确固定该行为 |

## 2. 实现

- `contracts/v2.ts`：`PUBLIC_CHAT_MODES` / `PublicChatMode`，`RoomSnapshot.room.publicChat`。
- `visibility/chat.ts`：`canPostPublic(state, playerId, policy)` 三档——`legacy_day_only`（保留为默认参数，v1 路由与只读分支行为不变）/ `alive_only` / `everyone`。阶段限制只对 `legacy_day_only` 生效。
- `server/capabilities.ts`：新增 `publicChat` 入参并透传；`server/v2/view.ts` 的 `gameView(..., publicChat)`；`server/v2/snapshots.ts` 与 `server/v2/app.ts` 的聊天路由都取 `room.publicChat`。
- `server/v2/stable-room.ts` / `room-directory.ts` / `app.ts`：房间记录新增只读 `publicChat`，建房时校验并落库到房间对象。
- `web-v2/src/features/game/sidebar.tsx`：**「阵营交流记录」从「情报」页签移到「公屏」页签、排在公屏记录之下**（2026-09-23，同一批）；页签顺序与数量不变（公屏/情报/记录/规则），未读圆点改由公屏页签承载 `unread.public + unread.faction`，`active` 也改为公屏页签。阵营房的可见性与读写权限完全未变（仍是 R-34/R-52 的成员制）。
- `web-v2/src/features/room/create.tsx`：新增「公屏权限」单选（`role="radiogroup"`，两个 `role="radio"`；未选时提交按钮禁用并给出提示）；`presentation/labels.ts` 的 `publicChatLabel` 供大厅「本局规则」与侧栏公屏页签复用。
- `docs/openapi-v2.2.json`：`PublicChatMode` schema、`/rooms` 请求体 `publicChat` 必填、`RoomSnapshot.room.publicChat` 必填。
- 契约夹具：`tests/fixtures/contract-2.1/*.json` 的 10 个 `RoomSnapshot` 样例补 `"publicChat": "alive_only"`（未整目录重导，避免随机 ID 噪声）。

## 3. 验证（2026-09-23，容器内）

**单测（增量，`node scripts/test-incremental.mjs`）**

- `tests/visibility.test.ts`：新增 T-33 档位矩阵（三档 × 昼夜 × 生死）。
- `tests/capabilities.test.ts`：档位透传（`alive_only` 夜间活人可写、死者不可写；`everyone` 死者可写；`legacy` 与只读分支不变）。
- `tests/v2-api.test.ts`：建房缺 `publicChat` → 400、非法值 → 400 `invalid_public_chat`、两种取值都能创建且 `room.publicChat` 正确回传。
- `tests/chat-receipts-api.test.ts`：**8 例**（新增 2 例）——`alive_only` 夜间活人 201 且「未公告死者」仍以公开存活判定；`everyone` 夜间死者 201 且消息对其他玩家公开可见。
- 回归批次：`frontend-v2-*` **21 文件 170 例**、服务端与 API **28 文件 142 例**、契约文档 `tests/contract-openapi.test.ts` **5 例**（含夹具 schema 校验），全部通过。

**四个 typecheck**：`typecheck`（服务端与 tests）、`typecheck:web:v2`、`typecheck:web:v2-tests` 均 exit 0。

**E2E（acceptance 栈 + seed，容器内 Playwright，双浏览器）**

| spec | 结果 | 覆盖 |
| --- | --- | --- |
| `specs-v2/02-rooms.spec.ts`（跳过既有失败的「实验房间」presence 用例） | **6 passed** | 建房表单「必须显式选择」（未选时提交禁用 + 提示 + 两个单选框 `aria-checked=false`）、创建请求体含 `publicChat`、大厅「本局规则」显示档位 |
| `specs-v2/06-chat-screen-real.spec.ts`（跳过依赖手动时钟的「真实转日公屏」用例） | **2 passed** | 真实服务端：夜间活人可发公屏（POST `channel=public` 201 + 对端可见）、公共观众没有输入框、阵营房与第二屏边界不变；**阵营交流记录在「公屏」页签内**（`real-faction-room-<project>.png`） |
| `specs-v2/05-information.spec.ts` | **2 passed**（chromium）/ 见下 | 阵营房输入与草稿仍在，但入口改到「公屏」页签；公屏草稿、500 字上限、重试链路不变 |
| `specs-v2/10-recovery.spec.ts`（真实服务端，chromium） | **2 passed** | 移动后阵营房草稿仍随页签切换与导航往返保留（「导航保留的阵营草稿」） |
| 临时探针（已删除） | **2 passed** | 三个全屏截图：未选、已选、入房后档位展示 |

截图（全屏 `fullPage`，本地产物，不入库）：`test-results-frontend-v2/probe-v2-public-chat-unselected-{chromium,webkit}.png`、`probe-v2-public-chat-selected-{chromium,webkit}.png`、`probe-v2-public-chat-lobby-{chromium,webkit}.png`、`real-chat-night-{chromium,webkit}.png`。

## 4. 未覆盖 / 已知项

- **`specs-v2/06-chat-screen-real.spec.ts` 的「真实转日公屏」用例未通过**：它等待 `public.phase` 变为 `day`，但验收假时钟只在显式 `advanceAcceptanceClock` 时前进，该用例从不推进时钟 → 150s 超时（与本变更无关，改动前也不在已记录的通过清单里）。
- `specs-v2/02-rooms.spec.ts` 的「实验房间」用例仍是既有 presence `offline` 断言失败（v2.0.5-alpha 期间已记录）。
- `everyone` 档位在真实浏览器里的**死者夜间发言**未做 E2E：需要先造出已公告的死亡并再次入夜，成本高；该路径由 `canPostPublic` / `capabilities` 单测与 `chat-receipts-api` 的服务端用例覆盖。
- v1 入口未改（仍「仅白天」），因此 `tests/server-api.test.ts` 与 `e2e/specs/03-security.spec.ts` 的夜间 403 反例保持原样。
- 未跑全量 Vitest / 全量 E2E，未重建镜像，未部署；分支未推送。
