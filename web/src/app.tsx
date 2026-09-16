import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, connectSocket } from './api.ts';
import { FACTION_NAMES, phaseLabel, ROLE_FACTIONS, ROLE_NAMES } from './format.ts';
import { GameScreen } from './game.tsx';
import { ReviewScreen } from './review.tsx';
import type {
  ChatMessage,
  ClientEvent,
  CommandReceipt,
  DisplayEvent,
  GameViewResponse,
  LobbyView,
  PushEvent,
  ReviewView,
  ViewResponse,
  VoicePermission,
} from './types.ts';

type Session =
  | { kind: 'loading' }
  | { kind: 'entry' }
  | { kind: 'lobby'; lobby: LobbyView }
  | { kind: 'game'; data: GameViewResponse };

function errorText(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }
  return '未知错误';
}

function toDisplay(event: PushEvent | ClientEvent): DisplayEvent {
  return {
    type: event.type,
    dayNumber: event.dayNumber,
    stage: event.stage,
    payload: event.payload,
  };
}

function mergeMessages(previous: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((left, right) => left.id - right.id);
}

export function App() {
  const [session, setSession] = useState<Session>({ kind: 'loading' });
  const [message, setMessage] = useState<string | null>(null);
  const [publicEvents, setPublicEvents] = useState<DisplayEvent[]>([]);
  const [personalEvents, setPersonalEvents] = useState<DisplayEvent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [review, setReview] = useState<ReviewView | null>(null);
  const [connected, setConnected] = useState(false);
  const [voicePermission, setVoicePermission] = useState<VoicePermission | null>(null);
  const serverOffset = useRef(0);

  const loadView = useCallback(async (mode: 'state' | 'all') => {
    try {
      const response: ViewResponse = await api.view();
      if ('view' in response) {
        setSession({ kind: 'game', data: response });
        setVoicePermission(response.voice.permission);
        serverOffset.current = response.serverTime - Date.now();
        if (mode === 'all') {
          setPublicEvents(response.view.publicEvents.map(toDisplay));
          setPersonalEvents(response.view.personalEvents.map(toDisplay));
        }
      } else {
        setSession({ kind: 'lobby', lobby: response });
      }
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
        setSession({ kind: 'entry' });
        setMessage(error.message);
        return;
      }
      setMessage(errorText(error));
    }
  }, []);

  const loadChat = useCallback(async () => {
    try {
      const result = await api.chatHistory('public', 0);
      setMessages((previous) => mergeMessages(previous, result.messages));
    } catch {
      // 聊天历史加载失败不阻塞主流程
    }
    try {
      const result = await api.chatHistory('faction', 0);
      setMessages((previous) => mergeMessages(previous, result.messages));
    } catch {
      // 非阵营房成员会 403，静默忽略
    }
  }, []);

  useEffect(() => {
    void loadView('all');
  }, [loadView]);

  useEffect(() => {
    if (session.kind !== 'lobby' && session.kind !== 'game') {
      return;
    }
    const timer = window.setInterval(() => {
      void loadView('state');
    }, 2500);
    return () => window.clearInterval(timer);
  }, [session.kind, loadView]);

  useEffect(() => {
    if (session.kind !== 'game') {
      return;
    }
    const socket = connectSocket({
      onConnect: () => {
        setConnected(true);
        void loadView('all');
        void loadChat();
      },
      onDisconnect: () => {
        setConnected(false);
      },
      onGameEvent: (event) => {
        const display = toDisplay(event);
        if (event.flow === 'public') {
          setPublicEvents((previous) => [...previous, display]);
        } else {
          setPersonalEvents((previous) => [...previous, display]);
        }
      },
      onChatMessage: (incoming) => {
        setMessages((previous) => mergeMessages(previous, [incoming]));
      },
      onVoicePermission: (permission) => {
        setVoicePermission(permission);
      },
    });
    return () => {
      socket.disconnect();
      setConnected(false);
    };
  }, [session.kind, loadView, loadChat]);

  const sendCommand = useCallback(
    async (action: string, extra: Record<string, unknown> = {}): Promise<CommandReceipt> => {
      const requestId = `${action}-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      try {
        const receipt = await api.command(requestId, action, extra);
        void loadView('state');
        return receipt;
      } catch (error) {
        void loadView('state');
        return {
          requestId,
          status: 'rejected',
          code: 'request_failed',
          message: errorText(error),
        };
      }
    },
    [loadView],
  );

  const openReview = useCallback(async () => {
    try {
      const result = await api.review();
      setReview(result.review);
    } catch (error) {
      setMessage(errorText(error));
    }
  }, []);

  const isGame = session.kind === 'game';
  const game = session.kind === 'game' ? session.data : null;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">剧院死神</span>
        {game !== null && (
          <span className="phase">
            {phaseLabel(game.phase, game.view.dayNumber, game.view.stage)}
          </span>
        )}
        {session.kind === 'lobby' && <span className="phase">大厅 {session.lobby.roomCode}</span>}
        {game !== null && (
          <span className="me">
            {game.view.self.seat}号 {game.view.self.nickname} · {ROLE_NAMES[game.view.self.roleId]} ·{' '}
            {FACTION_NAMES[ROLE_FACTIONS[game.view.self.roleId]]}
          </span>
        )}
        {isGame && (
          <span className={connected ? 'conn on' : 'conn'}>{connected ? '已连接' : '连接中'}</span>
        )}
      </header>
      {message !== null && (
        <button type="button" className="banner" onClick={() => setMessage(null)}>
          {message}
        </button>
      )}
      {session.kind === 'loading' && <div className="center">载入中…</div>}
      {session.kind === 'entry' && (
        <EntryScreen
          onDone={() => {
            setMessage(null);
            void loadView('all');
          }}
        />
      )}
      {session.kind === 'lobby' && (
        <LobbyScreen lobby={session.lobby} onChanged={() => void loadView('state')} />
      )}
      {game !== null && (
        <GameScreen
          data={game}
          publicEvents={publicEvents}
          personalEvents={personalEvents}
          messages={messages}
          serverOffset={serverOffset.current}
          voicePermission={voicePermission}
          onCommand={sendCommand}
          onOpenReview={() => void openReview()}
        />
      )}
      {review !== null && <ReviewScreen review={review} onClose={() => setReview(null)} />}
    </div>
  );
}

function EntryScreen({ onDone }: { onDone: () => void }) {
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const trimmed = nickname.trim();
  const codeTrimmed = code.trim();

  return (
    <div className="card entry">
      <h1>剧院死神</h1>
      <p className="muted">13 人 · 9 身份 · 在线法官</p>
      <label className="field">
        昵称
        <input
          value={nickname}
          maxLength={12}
          placeholder="1-12 个字符"
          onChange={(event) => setNickname(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={busy || trimmed.length === 0}
        onClick={() => void run(() => api.createRoom(trimmed))}
      >
        创建房间
      </button>
      <div className="row">
        <input
          value={code}
          maxLength={6}
          placeholder="房间码"
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
        <button
          type="button"
          disabled={busy || trimmed.length === 0 || codeTrimmed.length === 0}
          onClick={() => void run(() => api.joinRoom(codeTrimmed, trimmed))}
        >
          加入房间
        </button>
      </div>
      {error !== null && <p className="error">{error}</p>}
    </div>
  );
}

function LobbyScreen({ lobby, onChanged }: { lobby: LobbyView; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card lobby">
      <h2>
        大厅 <span className="code">{lobby.roomCode}</span>
      </h2>
      {lobby.rulesetMode === 'experimental' && (
        <p className="banner-experimental">
          实验模式：本局使用非默认板子配置，未经完整验证，仅供测试，不代表正式功能。
        </p>
      )}
      {!lobby.voice.enabled && (
        <p className="muted">语音未启用 · 文字测试模式（公屏与阵营房照常使用）</p>
      )}
      <p className="muted">
        把房间码发给同伴；满 {lobby.requiredPlayers} 人且全部准备后，由房主开始对局。
      </p>
      <ul className="members">
        {lobby.members.map((member) => (
          <li key={member.playerId}>
            <span>{member.nickname}</span>
            {member.isHost && <span className="tag">房主</span>}
            <span className={member.ready ? 'tag ok' : 'tag'}>
              {member.ready ? '已准备' : '未准备'}
            </span>
          </li>
        ))}
      </ul>
      <div className="row">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => api.setReady(lobby.roomCode, !lobby.you.ready))}
        >
          {lobby.you.ready ? '取消准备' : '准备'}
        </button>
        {lobby.you.isHost && (
          <button type="button" disabled={busy} onClick={() => void run(() => api.startGame(lobby.roomCode))}>
            开始对局
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (lobby.you.isHost && !window.confirm('确定解散房间？所有成员将回到入口页。')) {
              return;
            }
            void run(() => api.leaveRoom(lobby.roomCode));
          }}
        >
          {lobby.you.isHost ? '解散房间' : '退出房间'}
        </button>
      </div>
      {error !== null && <p className="error">{error}</p>}
    </div>
  );
}
