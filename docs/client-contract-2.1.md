# 前端接入契约 2.1

契约2.1已交付本地候选v2.1.0-rc.1，运行于http://localhost:3001。固定源码/镜像、验证范围及回滚点与逐步实施证据见贡献者本地的 2.1 验收/进度记录（未随仓库入库）；本仓库保留的当前接口契约与 schema 见 [契约2.2](client-contract-2.2.md) 与 [OpenAPI 2.2](openapi-v2.2.json)。新前端可按本契约开始对接。

前端接入顺序：[OpenAPI请求响应](openapi-v2.2.json)（2.1 版 OpenAPI 未随仓库入库，2.2 为当前 schema） → [动作参数及错误处理](client-contract-2.1-actions.md) → [事件字段与可见范围](client-contract-2.1-events.md) → [代理、Cookie、Socket与倒计时示例](client-contract-2.1-examples.md)。共享类型在contracts/v2.ts和contracts/catalog.ts；[完整JSON/mock索引](../tests/fixtures/contract-2.1/full-index.json)覆盖主要身份与阶段。运维与候选切换见 [运行手册](client-contract-2.1-runbook.md)。

## 版本与身份

API 前缀 `/api/v2`，规则版本 `2.0`，契约版本 `2.1`。账户名只读并作为显示名。Cookie 由服务端设置，浏览器不能读取令牌，也不把令牌写入 localStorage。`/auth/me` 查询当前登录身份；登录不自动接管其他设备的房间。

注册、登录与/auth/me统一返回 `{userId,username,avatarUrl,profileVersion,expiresAt}`。账号输入3–32位英文字母、数字、下划线，统一转小写保存和显示；密码12–128个UTF-16代码单元（与JavaScript字符串.length一致），登录仍验证原密码。邀请码预检POST `/auth/invitations/check`，提交invitation；成功返回valid=true，不消费。无效、已使用、过期、撤销或密码重置用途的token均返回403 invalid_invitation，注册事务还会重新校验。

Room 的 roomId 与房间码跨局不变。memberId 表示当前房间成员，显式离开再进入产生新 memberId。gameId/playerId 只属于一局；lobby 时 gameId=null。角色、座位由开局分配。参与过当前局的账号返回只能恢复本人，不能通过公开观战获得其他玩家视角。

本人房间列表中，activeHere 表示当前会话可以访问该成员身份；controlling 只表示正式成员的控制会话，观众为false。观众是否只读与观察对象由viewer明确表达，不能把“可以读取”当成“可以操作”。

进入房间只调用 `POST /rooms/:code/enter`。服务端决定正式/公开观众/恢复/需要显式接管；已有观众不会因为出现空位被自动转正式。使用 `promote` 申请转正式，失败仍是原观众。账号存在另一当前房间时返回 `already_in_room`，应先由用户明确离开。

2026-09-19 退出对齐：`POST /rooms/:code/leave` 保留原请求与响应格式，退出房间不注销账号。局中正式玩家显示“暂离对局”，本局席位保留，对局继续计时。复盘页提供直接“离开房间”。**2026-09-20 起**：房主在**大厅**退出即解散整房（响应带 `dissolved:true`）；房主在**对局中**退出仍是“暂离”并由其他在线正式成员按规则继任；房主在**复盘**退出按普通离开处理（房间保留、其他人继续复盘、房主同样继任）。房主另可在**任意阶段**主动解散（`POST /rooms/:code/dissolve`，仅房主；对局中会立即终止本局并按 `aborted` 记账）。复盘阶段无正式成员时立即关闭房间（含剩余观众），最后退出者的 `seatRetained=false`；单纯离线仍计为正式成员，但**全员离线满 24 小时**房间会被回收。大厅与进行中阶段无正式成员仍按5分钟清理。房主“结束复盘，返回大厅”是独立操作，保留原房间供下一局使用。完整对比见 [房间退出对齐](frontend-v2-room-exit.md)。

## 请求结果与重试

房间写操作使用 UUID requestId；同一意图重试复用 ID，不同意图生成新 ID。局内操作还必须携带 gameId，命令再带窗口的 windowInstanceId。身份从 Cookie 获取，不能提交 playerId 冒充操作者。旧 gameId 返回 `stale_game`，旧窗口返回 `stale_window`，超时返回 `window_closed`，同 ID 不同内容返回 `request_id_reused`。

建房的请求ID按账号保存；已有房间的管理操作按账号+房间码保存，并把操作名纳入指纹。准备与取消准备、进入与显式接管属于不同意图，要使用不同ID。退出或解散后重试可返回历史成功回执；这不会恢复房间，也不代表历史状态仍然成立，当前状态以最新快照为准。429/503表示尚未接纳，允许稍后同ID重试。

语音凭证与权限同步每次重新检查当前授权，不缓存短期令牌。邀请码回执涉及授权能力，重读时也要求当前本人控制权；已被接管的旧设备不能读到缓存中的邀请码。新的邀请签发需要新的请求ID。

命令结果不明时查询 `GET /rooms/:code/games/:gameId/receipts/:requestId`。`not_seen` 只表示查询执行时尚未看到记录，不能显示“操作失败”；可以原 ID 原载荷重试。`pending` 继续查询；`accepted/rejected` 是已有回执。查询永不重新执行动作，回执保留至当前复盘结束。注册响应丢失应使用用户名密码登录恢复，不盲目重复注册。

聊天使用 clientMessageId，返回与 Socket 快照相同的 messageId。乐观消息以 clientMessageId 关联，messageId 去重；不能把一次 HTTP 超时显示为肯定发送失败。聊天 cursor 只在当前有权读取的 game/channel 内排序，不跨局比较。

聊天text是纯文本，服务端去掉首尾空白并拒绝空内容；输入上限500个UTF-16代码单元。前端按文本渲染，乐观内容以服务端确认的text替换，不能将玩家消息解释为HTML或Markdown指令。

成功聊天按 gameId+本人 playerId+clientMessageId 保存原回执。相同完整载荷重试返回原201回执，不重复发送或消耗新消息频率额度；不同载荷复用ID返回409 request_id_reused。重试仍需当前本人控制权；新设备接管后旧会话不能读取旧回执。新一局重新计算，不继承上一局记录。审计库保存 messageId/clientMessageId，复盘沿用原 messageId；审计整数id不作为实时频道游标。

## Socket 与同步

Socket.IO 路径 `/api/v2/socket.io`，握手 auth 传 roomId。`view_updated` 发送完整授权快照。每个账号+roomId 的 viewVersion 单调递增，只计其可见内容变化；serverTime 自身变化不增加版本。重连后取完整快照，拒绝同 roomId 的旧版本；gameId 变化时清除旧角色、草稿、窗口、消息和提交状态。

最小 `control` 通知用 reason 区分 kicked、dissolved、taken_over、session_expired、host_changed、review_ended、left、screen_revoked。不可继续使用旧私有视图；接管/踢出/撤销后服务端停止旧授权推送。正常断线显示 reconnecting 最多15秒，心跳超时直接 offline；前端不要自行决定房主或删除离线成员。

windows 是并行窗口数组，不能把 windows[0] 当作全场唯一任务。使用任务给出的 windowInstanceId、允许动作及合法目标；目标重复是否允许按服务端返回配额表达。倒计时以 closesAt-serverTime 与收到快照的本地单调时钟估算；客户端倒计时为0只影响展示，最终由服务端检查截止。

团队proposal中的revision/targetPlayerIds/confirmedBy是最新草稿，locked表示存在全员确认候选（可能比最新草稿早）。effective提供此刻若截止将采用的revision、targetPlayerIds和basis（unanimous/latest_legal/empty）。主动空刀具有非空revision；没有可用提交时revision=null。前端应同时表达草稿与截止候选，不能把旧方案的locked状态标在未确认的新草稿上。

## 开发代理与头像

开发前端使用同源代理转发 `/api/v2`（包括 WebSocket）到后端。浏览器 origin 必须与后端 PUBLIC_BASE_URL 一致；HTTP 带 credentials，Socket 使用 withCredentials。不要开放通配 CORS 绕过配置。开发3003使用独立 cookie `td_account_contract_21`，候选3001使用 `td_account_v2`。端口不同不能隔离 Cookie，因此 cookie 名不能相同。

头像客户端先裁剪正方形，以 JPEG/PNG/WebP 原始二进制 PUT `/me/avatar`，不能包在 JSON/Base64 中。限制由 bootstrap 提供；成功后用响应 profile 替换本地资料。失败保留旧头像。avatarUrl=null 时显示前端静态默认头像。认证 GET 图片通过同源 Cookie 访问；版本化资源 URL 可以缓存，不应自己拼接文件路径。

每次保存递增profileVersion并刷新当前房间及本局席位头像；结束后的复盘也读取当前头像。上传最多5次/分钟，格式不符返回400/415 invalid_avatar、超过2MiB返回413 avatar_too_large。处理完成前会重新核对会话，退出登录或改密撤销后不能完成旧会话的上传。旧图在无引用满7天后由定期清理回收；未满7天的旧URL仍可由已登录账号读取。

个人音量、缩放等偏好由前端保存。只有 bootstrap 宣告启用 voice 时展示真实语音能力；当前本地候选语音关闭。准备、房主、可用动作和阻止原因均取自服务端 capabilities，客户端禁用按钮不能替代服务端授权。

无需登录即可GET `/bootstrap` 读取约束与已启用功能、GET `/catalog` 读取9角色、default-13正式预设、实验组合约束和完整2.0规则的10章。规则搜索在客户端完成；chapter-01至chapter-10是稳定章节ID。默认板13人，实验板至少5人、至多64人，角色数量表须包含全部9个键；只有魂灵/平民可重复，平民/科研员/死神/魂灵均必需且至少一种神职。角色摘要指向全文条款，不能取代房间冻结的实际config。
