# 后端 v2 接口契约

> 历史rc.1接口记录。新前端请使用 [契约2.1](client-contract-2.1.md) 与当前 [OpenAPI 2.2](openapi-v2.2.json)（2.1 的实施进度与验收记录为贡献者本地文档，未随仓库入库）。2.1仍使用/api/v2，但不保留本文旧join/watch/gameId握手协议。

本地候选入口 http://localhost:3001，仅提供API，未提供新版网页。旧版网页和对局仍使用3000端口，旧Cookie不能访问v2。

所有POST均为application/json。同源浏览器请求，生产必须HTTPS。账户Cookie为td_account_v2（HttpOnly、SameSite=Strict、7天，生产Secure），禁止把凭证放进URL。HTTP错误统一为 `{ "error": { "code": "...", "message": "..." } }`。

## 账号

| 方法与路径 | JSON输入 | 说明 |
| --- | --- | --- |
| POST /api/v2/auth/register | username, password, invitation | 一次性邀请码；账号名3–32位字母数字下划线、大小写不敏感；密码12–128字符 |
| POST /api/v2/auth/login | username, password | 设置Cookie，仅登录，不自动接管席位 |
| GET /api/v2/auth/me | 无 | 返回userId、expiresAt |
| POST /api/v2/auth/logout | {} | 撤销当前账号会话及关联租约 |
| POST /api/v2/auth/change-password | currentPassword, password | 修改密码后撤销全部旧会话 |
| POST /api/v2/auth/reset-password | token, password | 使用维护者签发的30分钟一次性重置码；撤销全部旧会话 |

## 房间与操作

以下均要求账号Cookie；code为房间码。

| 方法与路径 | JSON输入/输出要点 |
| --- | --- |
| POST /api/v2/rooms | nickname；可选roles数量表，自定义为experimental；返回roomCode/gameId/playerId |
| GET /api/v2/me/rooms | 本人房间列表、playerId和是否有当前控制租约 |
| POST /api/v2/rooms/:code/join | nickname；同一账号不能重复占同一房间席位 |
| POST /api/v2/rooms/:code/ready | ready布尔值 |
| POST /api/v2/rooms/:code/start | {}；房主且满员、全员准备 |
| POST /api/v2/rooms/:code/takeover | {}；显式接管本人席位，旧设备停止私有读取/操作/推送/语音 |
| POST /api/v2/rooms/:code/leave | {}；房主在大厅/复盘退出即解散整房，对局中退出保留席位、角色与计时，能再次接管 |
| GET /api/v2/rooms/:code/view | 完整授权快照，见下文 |
| POST /api/v2/rooms/:code/command | requestId、windowInstanceId、action；按需targets、revision、direction |
| POST /api/v2/rooms/:code/chat | channel=public或faction，text=1–500字符 |
| GET /api/v2/rooms/:code/review | 终局后开放完整复盘 |
| POST /api/v2/rooms/:code/kick | playerId；仅房主、仅大厅 |

目标统一用playerId数组targets。单目标行动最多一个；空数组表示主动放弃（查验、指定发言起点必须有目标）。EDIT_PROPOSAL保留数组中的重复目标，不能去重；CONFIRM_PROPOSAL传revision。DESIGNATE_SPEECH传单目标及direction=asc/desc。START_SPEECH不传目标，仅当前准备中的发言者可用。

示例请求（令牌和ID需从实际会话及view读取）：

```json
{"requestId":"guard-001","windowInstanceId":"g_example:night:1:guard","action":"SUBMIT_GUARD","targets":["p_example"]}
```

命令回执为 `{requestId,status:"accepted"|"rejected",code,message}`，合法格式命令的规则拒绝返回HTTP200及rejected回执。格式/授权错误使用400/401/403等。常见规则码包括stale_window、window_closed、request_id_reused、action_forbidden。幂等按对局+玩家+请求ID与标准化意图匹配，刷新不应重新生成同一重试请求的ID。

## 视图与实时推送

view返回apiVersion、rulesVersion、gameId、roomCode、serverTime、public、private、capabilities及windows数组。大厅private仅标识自己的玩家ID，游戏中包含self、个人事件、阵营房、合法目标与本人提案。普通观众private=null。

public只含已公布的事实和公共事件；private不得作为公共状态来源。capabilities提供canPostPublic/canPostFaction/canPublishVoice/canVote/allowedCommands。targets按行动列出playerIds、maxTargets、allowRepeated、canSkip和forbiddenPairs；列表不能代替服务器组合校验。窗口包含id/type、instanceId、closesAt；准备阶段为speech_prepare，其后的正式发言是新的实例。

chat包含public和faction两个已裁剪的消息数组，cursor为各数组自己的连续位置，不提供全局审计seq。客户端收到完整快照应整体替换，不重复累加事件或消息。

Socket.IO路径 `/api/v2/socket.io`，握手auth传 `{gameId}`，使用相同Cookie。监听view_updated获得与HTTP同源的完整快照；重连用HTTP重新对账。服务端每次推送重新校验租约，撤销时主动断开。HTTP不是Socket鉴权的替代物。

## 观战与第二屏

- POST rooms/:code/watch：普通公开观战，不接受bindPlayerId；返回spectatorId。
- POST rooms/:code/unwatch：退出当前观战。
- GET rooms/:code/spectators：房主查看观众ID及绑定目标；POST rooms/:code/kick-spectator传spectatorId移出。
- POST rooms/:code/second-screen/invitations：当前席位控制者签发5分钟一次性token。
- POST rooms/:code/second-screen/redeem：观众传token兑换，目标由服务器凭证决定。
- POST rooms/:code/second-screen/revoke：玩家撤销自己的第二屏和未兑换邀请。
- 第二屏只读、不发言、不开麦。拥有同局席位的账号不能观看其他玩家，即使使用另一设备。

## 媒体和诊断

POST rooms/:code/voice/token获得加入凭证（订阅角色：可听不可发；默认有效期30分钟）。发布权由服务端在状态推进时下发的**短期发布凭证（默认10分钟，覆盖最长90秒发言窗口）**授予，前端 `renewToken` 即时生效；收回时下发订阅凭证即时降权。POST rooms/:code/voice/sync重新同步。未配置语音时返回voice_disabled，游戏计时不暂停。

> 2026-09-19 媒体层已由 LiveKit 替换为**声网 Agora**（`voice/agora.ts`）：声网把发布权编码在 token 内，且**不提供**服务端实时改权限 API，因此按上面"短期发布凭证 + 到期兜底"实现 R-43；踢人（观战者）与终局关房改走声网频道管理 REST（一次性踢出、可立即重进）。
>
> 原 LiveKit 签名 Webhook（`/api/v2/voice/webhook`、`application/webhook+json`）在声网方案下**不再启用**：`server/v2/index.ts` 未注入 `verifyWebhook`，该路由不会被注册（`server/v2/app.ts` 保留为历史遗留）。周期同步仍会移出未知身份与失效租约。外部媒体服务失败时，网页/API撤销仍立即生效，远端媒体移出只能在连接恢复后重试，不能把模拟测试说成实机语音保证。

GET /healthz无认证，返回存活状态和API/规则版本；GET /api/v2/diagnostics需登录，提供rss、eventLoopP99Ms、房间数，不含身份或凭证。

账号可持久保存，但对局、席位与观战授权仍在内存；服务器重启后旧房间失效。未连接大厅2小时回收，终局24小时回收，审计记录不删除。单实例上限100个房间，实验板最多64席，观众每房间最多100人；这些是保护上限，不是容量承诺。
