# 2.1 动作与错误处理

所有游戏命令 POST `/api/v2/rooms/:code/command`。共同字段：`requestId`、`gameId`、`windowInstanceId`、`action`。targets 是 playerId 数组；操作者永远来自账号的控制会话。提交前使用当前快照任务的 action/windowInstanceId/目标约束；不能缓存上一局的目标。

JSON请求中的额外顶层字段目前会被忽略，不获得任何身份或权限含义，但仍计入完整请求指纹，因此重试不能增删这些字段。客户端只应发送已列字段；角色配置内未知roleId仍会被明确拒绝。响应schema保持明确字段限制，不能发送真实状态后交由前端隐藏。

| action | 窗口 | 额外参数 | 空选择含义 |
| --- | --- | --- | --- |
| SUBMIT_GUARD | guard | targets，0–2个不同玩家，以实际配置为准 | 空守 |
| SUBMIT_LAIKE | laike | targets，至多1个 | 空刺 |
| EDIT_PROPOSAL | faction | targets，以配额为准；允许重复同一目标表示多刀 | 主动空刀草稿 |
| CONFIRM_PROPOSAL | faction | revision，当前草稿版本正整数 | 无此语义 |
| SUBMIT_CHECK | check | targets，恰好1个 | 不合法；未提交按超时规则 |
| SUBMIT_RESCUE | rescue | targets，至多1个 | 不使用还魂曲 |
| SUBMIT_REVIVE | revive | targets，至多1个 | 放弃回归选择 |
| REGISTER_CANDIDACY | election_signup | 无 | 不适用 |
| WITHDRAW_CANDIDACY | election_signup/election_speech/speech_prepare | 无 | 退选 |
| START_SPEECH | speech_prepare | 无 | 本人提前开始正式计时 |
| END_ELECTION_SPEECH | election_speech | 无 | 本人提前结束 |
| SUBMIT_ELECTION_VOTE | election_vote | targets，至多1个 | 弃票 |
| DESIGNATE_SPEECH | speech_order | targets恰好1个；direction=asc/desc | 不合法；超时服务端默认顺序 |
| END_SPEECH | speech_round | 无 | 本人提前结束 |
| SUBMIT_DAY_VOTE | vote | targets，至多1个 | 弃票 |
| END_TIE_SPEECH | tie_speech | 无 | 本人提前结束 |
| END_LAST_WORDS | last_words | 无 | 本人提前结束遗言 |
| SUBMIT_HANDOVER | handover | targets，至多1个 | 销毁职务 |

固定夜间时长不会因为所有人提交而缩短。团队只有最新全员确认方案优先；从未全员确认才用最后合法草稿，不能在 UI 把未全员确认一律标成“不会执行”。查验结果按实际角色授权，不把 bool 推断为完整身份。

团队面板的 proposal.revision/targetPlayerIds/confirmedBy 表示最新草稿。`locked` 表示曾存在可执行的全员确认版本，并不等于最新草稿已全员确认。`effective` 明确给出如果此刻截止将执行的 revision、targetPlayerIds 与 basis（unanimous/latest_legal/empty）；后续合法编辑或确认仍可改变它。无方案时revision=null、targets为空；主动空刀是有revision的空目标方案。

| 稳定错误码/状态 | 客户端动作 |
| --- | --- |
| unauthorized / session_expired | 清理私有缓存，重新登录；自动重新登录不等于接管 |
| takeover_required | 显示显式接管入口，不循环自动重试 |
| already_in_room | 提示先明确离开当前房间，保留当前房间状态 |
| room_not_found / dissolved | 清理房间，返回房间码入口 |
| stale_game | 丢弃旧局任务/弹层，读取当前快照 |
| stale_window / window_closed | 停止当前提交，刷新窗口；不能换新ID投向下一窗口 |
| request_id_reused | 原ID已对应不同意图；恢复原回执或用新ID提交新的明确意图 |
| not_seen / pending | 结果尚未确定；查询或同ID同载荷重试，不宣称失败 |
| room_full | 转正式失败仍保留观众身份 |
| lobby_required / review_required | 刷新房间阶段并关闭不再有效的管理弹层 |
| not_host / room_access_required / seat_control_required | 刷新权限，禁用过期操作 |
| action_forbidden / chat_forbidden | 展示授权限制，不根据错误推断未公告死亡 |
| invalid_screen_invitation | 第二屏邀请无效、过期或已用；重新向目标玩家索取邀请 |
| second_screen_unavailable / player_cannot_spectate | 当前身份或目标第二屏名额不允许；本局原玩家走本人恢复路径 |
| voice_disabled / voice_unavailable / authorization_changed | 隐藏未启用能力或重新获取当前授权；不能继续使用旧语音身份 |
| invalid_ruleset / player_count_mismatch | 保留创建表单，按catalog校验修改 |
| invalid_invitation | 预检或注册失败，不视为账号已创建 |
| invalid_avatar / avatar_too_large | 保留旧头像，重新选择符合bootstrap限制的图 |
| avatar_busy / avatar_storage_unavailable | 分别为处理队列忙、存储失败；保留旧资料，稍后重试；响应丢失先查/auth/me |
| rate_limited | 稍后再试，保留原意图ID与用户输入 |

HTTP非2xx使用 `{ "error": { "code": "...", "message": "..." } }`；命令进入队列后的参数或规则拒绝使用命令回执 `{requestId,status:"rejected",code,message}`。鉴权、信封字段及入队失败使用非2xx。按code实现交互，不解析中文message；未知code使用通用失败提示并允许刷新。确切请求/响应见随候选交付的OpenAPI及JSON示例。
