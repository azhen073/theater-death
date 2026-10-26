# 客户端契约 2.2

API 前缀为 `/api/v2`，规则版本为 `2.0`。账号、成员和席位使用不可变内部 `userId`；玩家用数字 `uid` 登录，以 `nickname` 对外显示。完整请求和响应结构以 `openapi-v2.2.json` 为准。

## 账号

- `POST /auth/register`：`requestId`、`nickname`、`password`，成功后创建并登录。
- `POST /auth/login`：`uid`、`password`，不自动接管其他设备的房间控制权。
- `PATCH /me/profile`：修改昵称；仍有关联进行中房间时拒绝。
- `POST /auth/change-password`：校验当前密码并撤销旧会话。
- `GET /bootstrap` 的 `auth.registration` 表示是否开放注册，不影响已有账号登录。

昵称经 NFC 规范化后为 2–32 个 Unicode 码点，允许各语言文字、组合音标和下划线，至少包含一个文字。UID 以字符串传输，不回收。管理员接口见 `openapi-admin-v2.2.json`。

## 房间

创建房间必须显式提供：

- `publicChat`：`alive_only` 或 `everyone`，创建后不可修改。
- `freeSpeech`：布尔值，决定是否启用固定 120 秒的白天自由发言阶段。

`RoomSnapshot.room` 返回这两个配置。公屏写权限由 `capabilities.canPostPublic` 表示，观众和第二屏始终只读。

离开、解散、准备、开局、接管和观战都使用服务端解析的账号与成员身份。客户端不得通过载荷声明身份、座位或权限。

## 行动

`POST /rooms/{code}/command` 使用请求 ID 和当前窗口实例。团队方案 `EDIT_PROPOSAL` 可同时携带 `confirmSelf: true` 和非负整数 `expectedRevision`，并显式提供 `targets`：

- 两个组合字段必须同时出现。
- 服务端在房间串行队列中确认版本未变化后，原子创建新方案并确认提交者本人。
- 版本已变化时返回 `proposal_changed`，不产生部分写入。
- 相同请求 ID 重放不会创建重复方案。
- `capabilities.supportsProposalEditConfirmation` 只表示接口能力，不表示当前有编辑权限。

## 快照与语音

`RoomSnapshot.voice` 必有值或为 `null`：

- `channel`：对局使用 `gameId`，大厅与复盘使用 `l_<roomId>`。
- `uids`：对局映射到 `playerId`，房间映射到 `memberId`。
- `capabilities.canPublishVoice` 决定本人能否发布。
- `/voice/token` 的 `gameId` 仅对局频道需要；房间相位由服务端判断。
- `private.voice.delivery` 只在有发言窗口的对局内出现。

开局关闭房间频道，终局后回到房间频道；客户端不能通过旧 `gameId` 强制留在大厅频道。

## 公开与私有信息

- `public.night` 为 `{closesAt}` 或 `null`，只表示当前夜间段截止时间。
- `private.knowledge.spiritSeats` 是本人已知魂灵座位。
- `private.knowledge.dyingSeats` 只在符合身份、阶段和存活条件时出现，濒死不改变公开 `alive`。
- 私人事件、任务、提交状态和知识只在授权视图中返回。
- 快照使用 `viewVersion` 和服务端时间进行对账，客户端不能用本地时间决定行动顺序或方案版本。

契约夹具位于 `tests/fixtures/contract-2.2/`，可运行客户端示例位于 `docs/examples/contract-client.ts`。
