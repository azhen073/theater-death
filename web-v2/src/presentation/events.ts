import type { CatalogDTO } from '../../../contracts/catalog.ts';
import type { EventDTO, RoomSnapshot } from '../../../contracts/v2.ts';

export interface EventText { title: string; details: string[] }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const seatText = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? `${value}号` : '未公开玩家';
export function describeEvent(event: Pick<EventDTO, 'type' | 'payload'>, view: RoomSnapshot, catalog: CatalogDTO): EventText {
  const p = object(event.payload);
  const seats = (value: unknown) => list(value).map(seatText).join('、') || '无人';
  const player = (id: unknown) => seatText(view.public?.seats.find(item => item.playerId === id)?.seat);
  const role = (id: unknown) => catalog.roles.find(item => item.roleId === id)?.name ?? '未公开身份';
  const result = (title: string, ...details: string[]): EventText => ({ title, details });
  switch (event.type) {
    case 'game_started': return result('演出开始', '本局座位与身份已分配。');
    case 'night_started': return result('夜幕降临', typeof p.nightNumber === 'number' ? `第 ${p.nightNumber} 夜` : '夜间流程开始。');
    case 'role_assigned': return result('获得身份', role(p.roleId));
    case 'spirit_knowledge': return result('获知魂灵名单', seats(p.seats));
    case 'dying_list': return result('濒死情报', `本夜名单：${seats(p.seats)}`);
    case 'descender_check_result': return result('查验结果', `${seatText(p.targetSeat)}：${p.kind === 'is_spirit' ? p.answer === true ? '是魂灵' : p.answer === false ? '不是魂灵' : '结果未提供' : p.kind === 'in_death_faction' ? p.answer === true ? '属于死神阵营' : p.answer === false ? '不属于死神阵营' : '结果未提供' : '未提供可识别的查验结果'}`);
    case 'rescue_applied': return result('还魂曲生效', `目标：${player(p.targetPlayerId)}`);
    case 'faction_room_created': return result('阵营房已建立', `初始成员：${seats(p.memberSeats)}`);
    case 'faction_room_joined': return result('加入阵营房', p.readOnly === true ? '当前只读。' : '信息与交流以当前权限为准。');
    case 'election_started': return result('天理竞选开始');
    case 'candidacy_registered': return result(`${seatText(p.seat)}报名竞选`);
    case 'candidacy_withdrawn': return result(`${seatText(p.seat)}退出竞选`);
    case 'election_vote_started': return result('天理投票开始', `第 ${p.round ?? ''} 轮`);
    case 'election_revote_started': return result('天理竞选重投', `候选：${seats(p.seats)}`);
    case 'election_vote_progress': case 'vote_progress': return result('投票进度', `已投 ${typeof p.votedCount === 'number' ? p.votedCount : '—'} / ${typeof p.eligibleCount === 'number' ? p.eligibleCount : '—'}`);
    case 'election_result': case 'vote_result': {
      const votes = list(p.votes).map(value => object(value)).map(vote => `${seatText(vote.voterSeat)} → ${vote.targetSeat === null ? '弃票' : seatText(vote.targetSeat)}${typeof vote.units === 'number' ? `（${vote.units / 2}票）` : ''}`);
      const tally = list(p.tally).map(value => object(value)).map(row => `${seatText(row.seat)}：${typeof row.units === 'number' ? row.units / 2 : '—'}票`);
      const outcome = event.type === 'election_result' ? p.winnerSeat === null ? '本轮未产生当选者。' : `${seatText(p.winnerSeat)}当选。` : p.eliminatedSeat === null ? '本轮无人被放逐。' : `${seatText(p.eliminatedSeat)}被放逐。`;
      return result(event.type === 'election_result' ? '天理竞选票型' : '放逐投票票型', ...votes, `合计：${tally.join('；') || '未提供'}`, list(p.tiedSeats).length ? `平票：${seats(p.tiedSeats)}` : outcome);
    }
    case 'sheriff_elected': return result(`${seatText(p.seat)}当选天理`);
    case 'election_finished': return result('天理竞选结束', p.winnerSeat === null ? '本轮没有天理。' : `当选者：${seatText(p.winnerSeat)}`);
    case 'speech_order_pending': return result('等待指定发言顺序');
    case 'speech_round_started': return result('发言顺序已确定', seats(p.orderSeats));
    case 'candidate_speech_started': case 'speech_turn_started': case 'tie_speech_turn_started': return result(`${seatText(p.seat)}开始发言`);
    case 'candidate_speech_finished': case 'speech_turn_finished': case 'tie_speech_turn_finished': return result(`${seatText(p.seat)}结束发言`);
    case 'last_words_started': return result(`${seatText(p.seat)}开始遗言`);
    case 'last_words_finished': return result(`${seatText(p.seat)}结束遗言`);
    case 'day_vote_started': return result('放逐投票开始', `第 ${p.round ?? ''} 轮`);
    case 'tie_speech_started': return result('平票玩家发言', seats(p.seats));
    case 'revote_started': return result('放逐重投开始', seats(p.seats));
    case 'elimination_announced': return result(`${seatText(p.seat)}被放逐`);
    case 'sheriff_handover_started': return result('等待天理移交', `原天理：${seatText(p.fromSeat)}`);
    case 'sheriff_handover': return result('天理移交完成', p.heirSeat === null ? '职务已销毁。' : `继任者：${seatText(p.heirSeat)}`);
    case 'deaths_announced': return result('晨间死讯', `本夜死亡：${seats(p.seats)}`);
    case 'revive_announced': return result('深海召回', `${seatText(p.targetSeat)}回归。`);
    case 'reveal_announced': return result('身份公开', ...list(p.reveals).map(value => object(value)).map(item => `${seatText(item.seat)}：${role(item.roleId)}`));
    case 'researcher_announcement': return result('科研员公告', `存活死神阵营：${typeof p.count === 'number' ? p.count : '—'}人`);
    case 'stage_changed': return result('第二阶段开启');
    case 'door_returned': return result('门先生回归', seatText(p.seat));
    case 'game_ended': return result('演出落幕', p.winner === 'human' ? '人类阵营获胜' : p.winner === 'death_faction' ? '死神阵营获胜' : '等待结局信息', typeof p.reason === 'string' ? p.reason : '');
    case 'day_ended': return result('白天结束');
    default: return result('事件记录', '暂不支持此事件的详细展示。');
  }
}
