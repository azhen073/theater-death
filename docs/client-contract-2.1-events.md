# 契约2.1事件字典

对应规则2.0。快照携带事件记录，客户端按 type 渲染；不能把文字 reason 当稳定业务码，也不能通过事件自行授予权限。实际按钮、目标、提交状态取自 capabilities/tasks/submissionState。

普通事件结构为 `{cursor,type,dayNumber,stage,payload}`。cursor 是本人获授权的 public 或 private 流内序号，不是全局事件序号，两个流不能相互比较。playerId 是本局公开席位使用的不透明标识；是否可以看到其身份、死亡或行动，取决于事件投递范围。

下面 seat 均为本局座位号。`null` 表示未产生或主动放弃的目标。票数 units 使用半票整数单位：普通票2，天理票3；结果以服务端为准。

## 公共记录

| type | payload | 含义 |
| --- | --- | --- |
| game_started | `{dayNumber,seats:[{playerId,nickname,seat}]}` | 开局；事件历史字段nickname的值为账号名 |
| night_started | `{nightNumber,stage}` | 进入新夜 |
| speech_order_pending | `{sheriffSeat:number|null}` | 进入普通发言顺序阶段；没有可指定者时为空 |
| election_started | `{phase:'signup'}` | 首日竞选报名 |
| last_words_started / last_words_finished | `{scope:'first_night'|'elimination',seat}` | 该玩家遗言开始/结束 |
| sheriff_handover_started | `{fromSeat}` | 等待天理移交 |
| candidacy_registered / candidacy_withdrawn | `{seat}` | 报名/退选 |
| candidate_speech_started / candidate_speech_finished | `{seat}` | 竞选发言开始/结束 |
| election_vote_started | `{round,eligibleSeats:number[]}` | 竞选投票开始 |
| election_vote_progress | `{votedCount,eligibleCount}` | 竞选投票数量，未公开票型 |
| election_result | `{round,votes:[{voterSeat,targetSeat:number|null,units}],tally:[{seat,units}],tiedSeats:number[],winnerSeat:number|null}` | 结票后公开详情 |
| election_revote_started | `{seats:number[],eligibleSeats:number[]}` | 竞选重投 |
| sheriff_elected | `{seat}` | 天理当选 |
| election_finished | `{winnerSeat:number|null,reason:'elected'|'no_candidates'|'no_votes'|'tie_again'}` | 竞选结束 |
| speech_round_started | `{orderSeats:number[],startSeat,direction:'asc'|'desc',designatedBySeat:number|null}` | 普通发言顺序确定 |
| speech_turn_started / speech_turn_finished | `{seat}` | 普通发言开始/结束 |
| day_vote_started | `{round,eligibleSeats:number[]}` | 放逐投票开始 |
| vote_progress | `{votedCount,eligibleCount}` | 放逐投票数量，未公开票型 |
| vote_result | `{round,votes:[{voterSeat,targetSeat:number|null,units}],tally:[{seat,units}],tiedSeats:number[],eliminatedSeat:number|null}` | 放逐结票详情 |
| elimination_announced | `{seat}` | 放逐公告 |
| tie_speech_started | `{seats:number[]}` | 平票发言开始 |
| tie_speech_turn_started / tie_speech_turn_finished | `{seat}` | 当前平票者发言开始/结束 |
| revote_started | `{seats:number[],eligibleSeats:number[]}` | 放逐重投 |
| sheriff_handover | `{fromSeat,heirSeat:number|null}` | 移交或销毁完成 |
| reveal_announced | `{reveals:[{playerId,seat,roleId}]}` | 公开翻牌 |
| researcher_announcement | `{count}` | 科研员公开人数结果 |
| stage_changed | `{to:2,reason:'all_spirits_dead'|'researcher_dead'}` | 不可逆进入二阶段 |
| door_returned | `{seat}` | 门先生回归 |
| revive_announced | `{nightNumber,byWaterSeat,targetSeat}` | 水妖回归效果公告 |
| deaths_announced | `{nightNumber,seats:number[]}` | 晨间正式死讯；公告前不能推断真实死亡 |
| game_ended | `{winner:'human'|'death_faction',reason:string,dayNumber}` | 服务端已判终局；reason是供阅读的说明 |
| day_ended | `{dayNumber,nextNightNumber}` | 白天结束，进入下一夜 |

发言事件只描述事件历史。准备窗口与实际发言窗口以 windows/type、day.speechPreparing 和 currentSpeakerId 判断，不从事件名称猜计时。

## 个人记录

私人第二屏只能读取已授权目标的同一视角。普通观众没有下列事件。

| type | payload | 接收者 |
| --- | --- | --- |
| role_assigned | `{playerId,roleId}` | 本人 |
| spirit_knowledge | `{seats:number[]}` | 魂灵、死神、丧亲者各自获得魂灵名单 |
| faction_room_created | `{roomId,memberSeats:number[]}` | 魂灵 |
| faction_room_joined | `{roomId,readOnly:boolean}` | 二阶段加入的死神本人 |
| dying_list | `{nightNumber,seats:number[]}` | 一阶段未死亡的降临者，以及未死亡且未用还魂曲的水妖；濒死者仍可能有本夜资格 |
| descender_check_result | `{nightNumber,targetPlayerId,targetSeat,kind:'is_spirit'|'in_death_faction',answer:boolean}` | 降临者本人 |
| rescue_applied | `{nightNumber,targetPlayerId}` | 水妖与被救者 |

个人流不重复包含公共事件。阵营聊天另在 chat.faction 中，只有规则允许的历史可读；当前引擎没有实际发射独立的 faction 可见性事件流。

## 仅复盘解锁的记录

普通快照永不投递下列 server 事件。终局后的 review.timeline 才包含完整事件集合，结构为 `{dayNumber,stage,type,payload}`，按数组顺序显示；没有普通流 cursor。

| type | payload |
| --- | --- |
| attack_events | `{nightNumber,attacks:[{eventId,sourceRoleId,targetPlayerId,orderKey,blocked:boolean}]}` |
| guard_sacrifice | `{nightNumber,doorId,targets:string[]}` |
| rescue_declined | `{nightNumber}` |
| revive_selected | `{targetPlayerId}` |
| stage1_attack_disabled | `{nightNumber,overlap,threshold}` |
| night_deaths_confirmed | `{nightNumber,deaths:[{playerId,seat}]}` |

复盘还解锁各玩家角色与最终生命、完整公共/阵营聊天（包括加入前历史），不含账号会话或邀请令牌。房主结束复盘后，这个HTTP入口不再返回旧局；持久审计不是本期承诺的历史战绩接口。
