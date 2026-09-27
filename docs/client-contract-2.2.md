# 客户端契约 2.2：数字 UID 与直接注册

API 前缀保持 `/api/v2`，规则版本保持2.0。账号、房间席位、接管与媒体授权仍使用不可变内部 `userId`；玩家使用系统分配的数字 `uid` 登录，以可修改的 `nickname` 对外显示。

- `POST /auth/register`：`{requestId,nickname,password}`。成功创建并登录，返回 `{userId,uid,nickname,avatarUrl,profileVersion,expiresAt}`。同一请求、昵称和正确密码可恢复原注册；不同载荷或错误密码复用请求ID返回冲突。
- `POST /auth/login`：`{uid,password}`。登录不自动接管其他设备的房间控制权。
- `PATCH /me/profile`：`{nickname}`。任何关联房间仍在进行中时拒绝，包括死亡、离线或暂离的正式玩家及未退出观战者。
- `POST /auth/change-password`：当前密码加8–16位新密码；成功后撤销所有旧会话。迁移前超过16位的旧密码仍可用于登录。
- bootstrap 的 `auth.registration` 为 `open` 或 `closed`；关闭只影响新注册。

昵称在NFC规范化后为2–32个Unicode码点，只允许各语言文字、组合音标和下划线，至少含一个文字；保留英文大小写并允许重名。UID从10000001递增，以字符串传输，删除后不回收。

管理员接口见 `openapi-admin-v2.2.json`：注册开关、UID/昵称搜索、改昵称、停用/启用、直接设置新密码和永久删除。账号只在没有任何关联进行中对局时可删除。删除撤销凭证、会话及当前房间关系；完成对局保留开局时的UID、昵称、行动和交流，头像显示默认图。

旧schema3迁移到schema4时保留内部ID、密码哈希、会话、头像和资料版本；按创建时间及内部ID稳定分配UID，旧账号名成为初始昵称。注册邀请码及密码重置码不再提供；房间码和私人第二屏邀请不受影响。

## 团队方案原子提交扩展

`POST /api/v2/rooms/{code}/command` 的 `EDIT_PROPOSAL` 可选携带 `confirmSelf:true` 和 `expectedRevision`（非负整数）。两字段必须同时出现，并显式提供 `targets`；服务端在房间串行队列中校验当前最新版本等于 `expectedRevision`，再原子创建新版本并确认提交者本人。成功仍返回一个既有 `CommandReceipt`，同一请求ID重放不会创建重复版本。

快照能力 `capabilities.supportsProposalEditConfirmation=true` 表示支持此扩展，不代表当前玩家具有编辑或确认权限。缺省或 false 时，客户端继续使用独立的 `EDIT_PROPOSAL` 与 `CONFIRM_PROPOSAL`。组合参数错误返回 `invalid_proposal_options`；依据版本已变化返回 `proposal_changed`，状态不产生部分写入。旧的、不带扩展字段的编辑语义保持不变。

## 公屏写权限档位（2026-09-23 新增，用户裁定 Q-10）

`POST /api/v2/rooms` 新增**必填**字段 `publicChat`，取值 `alive_only` 或 `everyone`（无默认值，缺失或非法返回 400 `invalid_public_chat`；创建后不可修改，`RoomSnapshot.room.publicChat` 原样回传）。公屏文字因此改为**对局内所有阶段可写**（夜间不再禁发）：`alive_only` 下仅存活正式玩家可写、死者只读（本人获准遗言期间仍可写）；`everyone` 下存活与死者都可写。`POST /rooms/{code}/chat`（`channel=public`）的 403 `chat_forbidden` 判定改由该档位与 `capabilities.canPostPublic` 决定；观众与第二屏在任何档位下都只读。夜间语音不受影响，仍按 R-43 全体静音。旧的、不带该字段的调用方会收到 400，属于本次契约收紧。

## 白天自由发言阶段（2026-09-23 新增，用户裁定 Q-11）

`POST /api/v2/rooms` 新增**必填**布尔字段 `freeSpeech`（缺失或非布尔返回 400 `invalid_free_speech`；`true`/`false` 都可，没有默认值）。选择「开启」时，冻结规则 `room.config.timersSeconds.freeSpeech = 120`，`RoomSnapshot.room.freeSpeech === true`；选择「不开启」时该键从冻结规则里移除、`room.freeSpeech === false`（1.1 板本来就不带该键）。开启后**每个白天**在**发言轮结束、放逐投票开始之前**插入固定 **120 秒**的阶段：`DayDTO.step === 'free_speech'`，公开窗口 `windows[].id === 'free_speech'`（给全桌倒计时），该阶段**不提前结束**。语音上**全体存活玩家**的 `capabilities.canPublishVoice` 为 `true`（可同时开麦；死者仍为 `false`），`private.voice.delivery` 照常下发（无唯一发言者：聚合按窗口计数，任何发布者自己的回执都不计，见 `docs/frontend-v2-voice.md`）。新增可选 `PublicGameDTO.voice.uids`：频道 `uid → playerId` 映射，仅供客户端把本机远端电平归属到座位显示「谁在说话」，不含隐藏信息；对局中才出现。

## 公开夜幕时钟与私人身份知识

`RoomSnapshot.public.night` 为 `{closesAt}` 或 `null`：夜间阶段给出**当前夜间段**的截止时间，供全桌（含无夜间任务者与观战者）显示剩余时间；不包含段名与段数，白天与大厅为 `null`。该字段与角色私有窗口（`windows`/`tasks`）相互独立，不随提前提交缩短。

`RoomSnapshot.private.knowledge.spiritSeats` 为**本人已知的魂灵座位号**（升序，含已出局者）：死神与丧亲者知晓全部魂灵（R-27、R-31），魂灵知晓其他魂灵（R-30，不含自己），其余身份为空数组。该字段只出现在本人（含绑定第二屏）的私人视图，用于座位标记与身份弹窗；公共视图与观战者没有该字段。
