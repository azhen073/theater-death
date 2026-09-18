import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import {
  describeEvent,
  formatClock,
  formatRemain,
  ROLE_HINTS,
  ROLE_NAMES,
  WINDOW_LABELS,
  type EventLabels,
} from './format.ts';
import type {
  ChatMessage,
  CommandReceipt,
  DisplayEvent,
  FactionRoomView,
  GameViewResponse,
  LifeState,
  SeatPublicView,
  VoicePermission,
} from './types.ts';
import { VoicePanel } from './voice.tsx';

interface GameScreenProps {
  readonly data: GameViewResponse;
  readonly publicEvents: readonly DisplayEvent[];
  readonly personalEvents: readonly DisplayEvent[];
  readonly messages: readonly ChatMessage[];
  readonly serverOffset: number;
  readonly voicePermission: VoicePermission | null;
  onCommand(action: string, extra?: Record<string, unknown>): Promise<CommandReceipt>;
  onOpenReview(): void;
  onLeaveSpectate(): void;
  onLeaveRoom(): void;
}

export function GameScreen(props: GameScreenProps) {
  const { data, publicEvents, personalEvents, messages, serverOffset } = props;
  const { view, hints, windows, proposal } = data;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 300);
    return () => window.clearInterval(timer);
  }, []);

  const serverNow = now + serverOffset;

  const labels = useMemo<EventLabels>(() => {
    const byPlayer = new Map(view.seats.map((seat) => [seat.playerId, seat]));
    const player = (playerId: string): string => {
      const seat = byPlayer.get(playerId);
      return seat === undefined ? playerId : `${seat.seat}号 ${seat.nickname}`;
    };
    return {
      seat: (seat) => `${seat}号`,
      seats: (list) => list.map((seat) => `${seat}号`).join('、'),
      player,
      players: (ids) => ids.map(player).join('、'),
    };
  }, [view.seats]);

  const ended = view.phase === 'ended';
  const spectating = data.spectating;

  return (
    <div className="game">
      <div className="col">
        <section className="card">
          <h3>座次</h3>
          <div className="seats">
            {view.seats.map((seat) => (
              <div
                key={seat.playerId}
                className={`seat${seat.alive ? '' : ' dead'}${
                  seat.playerId === view.self.playerId ? ' mine' : ''
                }`}
              >
                <span className="seat-no">{seat.seat}</span>
                <span className="seat-name">{seat.nickname}</span>
                {seat.seat === hints.sheriffSeat && <span className="tag">天理</span>}
                {seat.revealedRoleId !== null && (
                  <span className="tag role">{ROLE_NAMES[seat.revealedRoleId]}</span>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="card identity">
          <h3>{spectating === null ? '你的身份' : '绑定玩家的身份'}</h3>
          <p>
            {labels.seat(view.self.seat)} {view.self.nickname} · {ROLE_NAMES[view.self.roleId]} ·{' '}
            {lifeText(view.self.life)}
            {view.self.revealed ? ' · 已翻牌' : ''}
            {view.self.voteFrozen ? ' · 票权冻结' : ''}
          </p>
          <p className="muted">{ROLE_HINTS[view.self.roleId]}</p>
          {view.self.guardHistory.length > 0 && (
            <p className="muted">
              守护记录：
              {view.self.guardHistory
                .map(
                  (record) =>
                    `第${record.nightNumber}夜 ${record.targetPlayerIds
                      .map((id) => labels.player(id))
                      .join('、')}`,
                )
                .join('；')}
            </p>
          )}
        </section>
      </div>

      <div className="col">
        <section className="card">
          <h3>公告</h3>
          <EventList events={publicEvents} labels={labels} />
        </section>
        <section className="card">
          <h3>{spectating === null ? '仅你可见' : '仅绑定玩家可见'}</h3>
          <EventList events={personalEvents} labels={labels} personal />
        </section>
      </div>

      <div className="col">
        <section className="card">
          <h3>当前窗口</h3>
          {windows.length === 0 && <p className="muted">无进行中的窗口</p>}
          <div className="windows">
            {windows.map((window) => (
              <span key={window.id} className="window">
                {WINDOW_LABELS[window.id] ?? window.id}
                <strong>{formatRemain(window.closesAt - serverNow)}</strong>
              </span>
            ))}
          </div>
        </section>
        {ended && (
          <section className="card">
            <h3>对局结束</h3>
            <div className="row">
              <button type="button" className="primary" onClick={props.onOpenReview}>
                查看复盘
              </button>
              {spectating === null && (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        '退出房间会释放你的席位，之后无法再看这份复盘且不能重新加入。确定退出？',
                      )
                    ) {
                      props.onLeaveRoom();
                    }
                  }}
                >
                  退出房间
                </button>
              )}
            </div>
          </section>
        )}
        {!ended && spectating === null && (
          <ActionPanel
            data={data}
            labels={labels}
            personalEvents={personalEvents}
            onCommand={props.onCommand}
          />
        )}
        {spectating !== null && (
          <section className="card">
            <h3>观战</h3>
            <p className="muted">
              只读观战：视角跟随 {labels.player(spectating.bindPlayerId)}，不能操作或发言。
            </p>
            <button type="button" onClick={props.onLeaveSpectate}>
              退出观战
            </button>
          </section>
        )}
        {!ended && (
          <VoicePanel
            enabled={data.voice.enabled}
            permission={props.voicePermission ?? data.voice.permission}
            spectating={spectating !== null}
          />
        )}
        <ChatPanel
          room={view.room}
          canPostPublic={spectating === null && view.phase === 'day' && view.self.life === 'alive'}
          readOnly={spectating !== null}
          messages={messages}
          labels={labels}
        />
      </div>
    </div>
  );
}

function lifeText(life: LifeState): string {
  switch (life) {
    case 'dead':
      return '已出局';
    case 'dying':
      return '濒死';
    default:
      return '存活';
  }
}

function EventList({
  events,
  labels,
  personal = false,
}: {
  events: readonly DisplayEvent[];
  labels: EventLabels;
  personal?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = listRef.current;
    if (node !== null) {
      node.scrollTop = node.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className={personal ? 'events personal' : 'events'} ref={listRef}>
      {events.length === 0 && <p className="muted">（暂无）</p>}
      {events.map((event, index) => (
        <p key={`${event.type}-${index}`} className="ev">
          <span className="ev-day">D{event.dayNumber}</span>
          {describeEvent(event, labels)}
        </p>
      ))}
    </div>
  );
}

interface ActionPanelProps {
  readonly data: GameViewResponse;
  readonly labels: EventLabels;
  readonly personalEvents: readonly DisplayEvent[];
  onCommand(action: string, extra?: Record<string, unknown>): Promise<CommandReceipt>;
}

function ActionPanel(props: ActionPanelProps) {
  const { data, labels, personalEvents, onCommand } = props;
  const { view, hints, windows, proposal } = data;
  const self = view.self;
  const [selection, setSelection] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const windowKey = windows.map((window) => window.id).join(',');
  useEffect(() => {
    setSelection([]);
    setNotice(null);
  }, [windowKey, view.dayNumber]);

  const fire = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setNotice(null);
    const receipt = await onCommand(action, extra);
    setNotice(
      receipt.status === 'accepted'
        ? '已提交'
        : `被拒绝：${receipt.message ?? receipt.code ?? '未知原因'}`,
    );
    setBusy(false);
    setSelection([]);
  };

  const aliveSeats = view.seats.filter((seat) => seat.alive);
  const deadSeats = view.seats.filter((seat) => !seat.alive);

  const dyingSeats = (() => {
    for (let index = personalEvents.length - 1; index >= 0; index -= 1) {
      const event = personalEvents[index];
      if (event.type !== 'dying_list') {
        continue;
      }
      const payload = event.payload as { seats?: unknown };
      const seats = Array.isArray(payload.seats)
        ? payload.seats.filter((item): item is number => typeof item === 'number')
        : [];
      return seats
        .map((seat) => view.seats.find((item) => item.seat === seat))
        .filter((item): item is SeatPublicView => item !== undefined);
    }
    return [];
  })();

  let body: ReactNode;
  if (view.phase === 'night') {
    const active = new Set(windows.map((window) => window.id));
    body = (
      <>
        {self.roleId === 'door' && active.has('guard') && (
          <div className="action">
            <p className="muted">守护至多两名存活玩家；可以空守。</p>
            <TargetPicker seats={aliveSeats} value={selection} onChange={setSelection} max={2} />
            <div className="row">
              <button
                type="button"
                disabled={busy}
                onClick={() => void fire('SUBMIT_GUARD', { targets: selection })}
              >
                提交守护
              </button>
              <button type="button" disabled={busy} onClick={() => void fire('SUBMIT_GUARD', { targets: [] })}>
                空守
              </button>
            </div>
          </div>
        )}
        {self.roleId === 'laike' && active.has('laike') && (
          <div className="action">
            <p className="muted">刺杀一名存活玩家（可放弃）；行动后翻牌、票权冻结。</p>
            <TargetPicker seats={aliveSeats} value={selection} onChange={setSelection} max={1} />
            <div className="row">
              <button
                type="button"
                disabled={busy || selection.length !== 1}
                onClick={() => void fire('SUBMIT_LAIKE', { target: selection[0] })}
              >
                确认刺杀
              </button>
              <button type="button" disabled={busy} onClick={() => void fire('SUBMIT_LAIKE', { target: null })}>
                放弃刺杀
              </button>
            </div>
          </div>
        )}
        {(self.roleId === 'death' || self.roleId === 'spirit') && active.has('faction') && (
          <div className="action">
            {proposal === null ? (
              <p className="muted">阵营协商：等待会话就绪。</p>
            ) : (
              <>
                <p className="muted">
                  {proposal.pool === 'joint'
                    ? '联合行动'
                    : proposal.pool === 'death'
                      ? '死神行动'
                      : '魂灵行动'}{' '}
                  · {proposal.revision === 0 ? '尚无草稿' : `草稿 v${proposal.revision}`} · 已确认{' '}
                  {proposal.confirmedBy.filter((id) => proposal.activeMemberIds.includes(id)).length}/
                  {proposal.activeMemberIds.length}
                  {proposal.locked ? ' · 已锁定' : ''}
                </p>
                {proposal.revision > 0 && (
                  <p>
                    当前目标：
                    {proposal.targetPlayerIds.length === 0
                      ? '空'
                      : labels.players(proposal.targetPlayerIds)}
                  </p>
                )}
                <TargetPicker seats={aliveSeats} value={selection} onChange={setSelection} max={4} />
                <div className="row">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void fire('EDIT_PROPOSAL', { targets: selection })}
                  >
                    提交草稿
                  </button>
                  <button
                    type="button"
                    disabled={busy || proposal.revision === 0}
                    onClick={() => void fire('CONFIRM_PROPOSAL', { revision: proposal.revision })}
                  >
                    确认草稿 v{proposal.revision}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {self.roleId === 'descender' && active.has('check') && (
          <div className="action">
            <p className="muted">
              查验一名存活玩家（结果仅你可见）：阶段一验魂灵，阶段二验死神阵营。
            </p>
            <TargetPicker seats={aliveSeats} value={selection} onChange={setSelection} max={1} />
            <button
              type="button"
              disabled={busy || selection.length !== 1}
              onClick={() => void fire('SUBMIT_CHECK', { target: selection[0] })}
            >
              查验
            </button>
          </div>
        )}
        {self.roleId === 'water' && active.has('rescue') && (
          <div className="action">
            <p className="muted">本夜濒死名单（仅你与降临者可见）：</p>
            <p>{dyingSeats.length === 0 ? '无' : dyingSeats.map((seat) => `${seat.seat}号 ${seat.nickname}`).join('、')}</p>
            <TargetPicker seats={dyingSeats} value={selection} onChange={setSelection} max={1} />
            <div className="row">
              <button
                type="button"
                disabled={busy || selection.length !== 1}
                onClick={() => void fire('SUBMIT_RESCUE', { target: selection[0] })}
              >
                使用还魂曲
              </button>
              <button type="button" disabled={busy} onClick={() => void fire('SUBMIT_RESCUE', { target: null })}>
                不使用
              </button>
            </div>
          </div>
        )}
        {self.roleId === 'water' && active.has('revive') && (
          <div className="action">
            <p className="muted">从死者中深海召回一人（可放弃）。</p>
            <TargetPicker seats={deadSeats} value={selection} onChange={setSelection} max={1} />
            <div className="row">
              <button
                type="button"
                disabled={busy || selection.length !== 1}
                onClick={() => void fire('SUBMIT_REVIVE', { target: selection[0] })}
              >
                深海召回
              </button>
              <button type="button" disabled={busy} onClick={() => void fire('SUBMIT_REVIVE', { target: null })}>
                放弃
              </button>
            </div>
          </div>
        )}
        {!hasNightAction(self.roleId, [...active]) && (
          <p className="muted">今夜你没有需要执行的操作，请等待天亮。</p>
        )}
      </>
    );
  } else if (view.phase === 'day' || view.phase === 'morning') {
    const windowId = windows[0]?.id ?? null;
    const isSpeaker = hints.speakerSeat !== null && hints.speakerSeat === self.seat;
    const isSheriff = hints.sheriffSeat !== null && hints.sheriffSeat === self.seat;
    const alive = self.life !== 'dead';
    const candidateSeats = hints.candidateSeats
      .map((seat) => view.seats.find((item) => item.seat === seat))
      .filter((item): item is SeatPublicView => item !== undefined);
    body = (
      <>
        {windowId === 'last_words' && (
          <div className="action">
            <p className="muted">{isSpeaker ? '轮到你发表遗言。' : '等待遗言结束。'}</p>
            {isSpeaker && (
              <button type="button" disabled={busy} onClick={() => void fire('END_LAST_WORDS')}>
                结束遗言
              </button>
            )}
          </div>
        )}
        {windowId === 'election_signup' && (
          <div className="action">
            <p className="muted">天理竞选报名中。{hints.candidateSeats.length} 人已报名。</p>
            {alive &&
              (hints.candidateSeats.includes(self.seat) ? (
                <button type="button" disabled={busy} onClick={() => void fire('WITHDRAW_CANDIDACY')}>
                  退出竞选
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => void fire('REGISTER_CANDIDACY')}>
                  报名竞选天理
                </button>
              ))}
          </div>
        )}
        {windowId === 'election_speech' && (
          <div className="action">
            <p className="muted">{isSpeaker ? '轮到你发表竞选发言。' : '等待竞选发言。'}</p>
            {isSpeaker && (
              <button type="button" disabled={busy} onClick={() => void fire('END_ELECTION_SPEECH')}>
                结束发言
              </button>
            )}
          </div>
        )}
        {(windowId === 'election_vote' || windowId === 'election_revote') && (
          <div className="action">
            <p className="muted">竞选投票：候选人 {candidateSeats.map((seat) => `${seat.seat}号 ${seat.nickname}`).join('、') || '无'}。</p>
            {alive && !self.voteFrozen ? (
              <>
                <TargetPicker seats={candidateSeats} value={selection} onChange={setSelection} max={1} />
                <div className="row">
                  <button
                    type="button"
                    disabled={busy || selection.length !== 1}
                    onClick={() => void fire('SUBMIT_ELECTION_VOTE', { target: selection[0] })}
                  >
                    投给选中者
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void fire('SUBMIT_ELECTION_VOTE', { target: null })}
                  >
                    弃权
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">你没有当前票权。</p>
            )}
          </div>
        )}
        {windowId === 'speech_order' && (
          <div className="action">
            <p className="muted">
              {isSheriff ? '作为天理，指定发言起点与方向。' : '等待天理指定发言顺序（超时默认升序）。'}
            </p>
            {isSheriff && (
              <>
                <TargetPicker seats={aliveSeats} value={selection} onChange={setSelection} max={1} />
                <div className="row">
                  <button
                    type="button"
                    disabled={busy || selection.length !== 1}
                    onClick={() => void fire('DESIGNATE_SPEECH', { start: selection[0], direction: 'asc' })}
                  >
                    升序指定
                  </button>
                  <button
                    type="button"
                    disabled={busy || selection.length !== 1}
                    onClick={() => void fire('DESIGNATE_SPEECH', { start: selection[0], direction: 'desc' })}
                  >
                    降序指定
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {windowId === 'speech_round' && (
          <div className="action">
            <p className="muted">
              {isSpeaker ? '轮到你发言。' : `等待发言${hints.speakerSeat === null ? '' : `（${hints.speakerSeat}号）`}。`}
            </p>
            {isSpeaker && (
              <button type="button" disabled={busy} onClick={() => void fire('END_SPEECH')}>
                结束发言
              </button>
            )}
          </div>
        )}
        {(windowId === 'vote' || windowId === 'vote_revote') && (
          <div className="action">
            <p className="muted">放逐投票（可弃权）。</p>
            {alive && !self.voteFrozen ? (
              <>
                <TargetPicker seats={aliveSeats} value={selection} onChange={setSelection} max={1} />
                <div className="row">
                  <button
                    type="button"
                    disabled={busy || selection.length !== 1}
                    onClick={() => void fire('SUBMIT_DAY_VOTE', { target: selection[0] })}
                  >
                    投给选中者
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void fire('SUBMIT_DAY_VOTE', { target: null })}
                  >
                    弃权
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">你没有当前票权。</p>
            )}
          </div>
        )}
        {windowId === 'tie_speech' && (
          <div className="action">
            <p className="muted">{isSpeaker ? '轮到你发表平票发言。' : '等待平票发言。'}</p>
            {isSpeaker && (
              <button type="button" disabled={busy} onClick={() => void fire('END_TIE_SPEECH')}>
                结束发言
              </button>
            )}
          </div>
        )}
        {windowId === 'handover' && (
          <div className="action">
            <p className="muted">{isSpeaker ? '作为卸任天理，指定继承人或放弃。' : '等待天理移交。'}</p>
            {isSpeaker && (
              <>
                <TargetPicker seats={aliveSeats} value={selection} onChange={setSelection} max={1} />
                <div className="row">
                  <button
                    type="button"
                    disabled={busy || selection.length !== 1}
                    onClick={() => void fire('SUBMIT_HANDOVER', { target: selection[0] })}
                  >
                    指定继承
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void fire('SUBMIT_HANDOVER', { target: null })}
                  >
                    放弃移交
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {windowId === null && <p className="muted">结算中…</p>}
      </>
    );
  } else {
    body = <p className="muted">对局已结束。</p>;
  }

  return (
    <section className="card">
      <h3>你的行动</h3>
      {notice !== null && <p className="notice">{notice}</p>}
      {body}
    </section>
  );
}

function hasNightAction(roleId: string, windows: readonly string[]): boolean {
  const active = new Set(windows);
  if (roleId === 'door' && active.has('guard')) return true;
  if (roleId === 'laike' && active.has('laike')) return true;
  if ((roleId === 'death' || roleId === 'spirit') && active.has('faction')) return true;
  if (roleId === 'descender' && active.has('check')) return true;
  if (roleId === 'water' && (active.has('rescue') || active.has('revive'))) return true;
  return false;
}

function TargetPicker({
  seats,
  value,
  onChange,
  max,
}: {
  seats: readonly SeatPublicView[];
  value: readonly string[];
  onChange(next: string[]): void;
  max: number;
}) {
  const toggle = (playerId: string) => {
    if (value.includes(playerId)) {
      onChange(value.filter((id) => id !== playerId));
      return;
    }
    if (value.length >= max) {
      return;
    }
    onChange([...value, playerId]);
  };
  if (seats.length === 0) {
    return <p className="muted">无可选目标</p>;
  }
  return (
    <div className="picker">
      {seats.map((seat) => (
        <button
          key={seat.playerId}
          type="button"
          className={value.includes(seat.playerId) ? 'chip on' : 'chip'}
          onClick={() => toggle(seat.playerId)}
        >
          {seat.seat}号 {seat.nickname}
        </button>
      ))}
    </div>
  );
}

function ChatPanel({
  room,
  canPostPublic,
  messages,
  labels,
  readOnly = false,
}: {
  room: FactionRoomView | null;
  canPostPublic: boolean;
  messages: readonly ChatMessage[];
  labels: EventLabels;
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState<'public' | 'faction'>('public');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasRoom = room !== null;

  useEffect(() => {
    if (!hasRoom) {
      setTab('public');
    }
  }, [hasRoom]);

  const visible = messages.filter((message) => message.channel === tab);
  const canWrite = readOnly
    ? false
    : tab === 'public'
      ? canPostPublic
      : (room?.canWrite ?? false);

  const send = async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.sendChat(tab, trimmed);
      setText('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发送失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card chat">
      <div className="tabs">
        <button
          type="button"
          className={tab === 'public' ? 'tab on' : 'tab'}
          onClick={() => setTab('public')}
        >
          公屏
        </button>
        {room !== null && (
          <button
            type="button"
            className={tab === 'faction' ? 'tab on' : 'tab'}
            onClick={() => setTab('faction')}
          >
            阵营房{room.readOnly ? '（只读）' : ''}
          </button>
        )}
      </div>
      <div className="messages">
        {visible.length === 0 && <p className="muted">（暂无消息）</p>}
        {visible.map((message) => (
          <p key={message.id} className="msg">
            <span className="msg-from">{labels.player(message.senderId)}</span>
            <span className="msg-time">{formatClock(message.at)}</span>
            <span className="msg-text">{message.text}</span>
          </p>
        ))}
      </div>
      <div className="row">
        <input
          value={text}
          maxLength={500}
          placeholder={readOnly ? '观战只读' : canWrite ? '输入消息…' : '当前不可发言'}
          disabled={!canWrite || busy}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void send();
            }
          }}
        />
        <button type="button" disabled={!canWrite || busy || text.trim().length === 0} onClick={() => void send()}>
          发送
        </button>
      </div>
      {error !== null && <p className="error">{error}</p>}
    </section>
  );
}
