import { useEffect, useRef, useState } from 'react';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { VOICE_INPUT_MAX, VOICE_LEVEL_SEGMENTS, agcEnabledFor, levelSegments, ownLevelVisible, voiceLevelDisplay } from '../../presentation/voice-levels.ts';
import { usePreferences } from '../../state/preferences.ts';
import { VoiceSession, type VoiceState } from './session.ts';

function LevelMeter({ label, level }: { label: string; level: number }) {
  const filled = levelSegments(level);
  return (
    <span className="level-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={level}>
      {Array.from({ length: VOICE_LEVEL_SEGMENTS }, (_, index) => <i key={index} className={index < filled ? 'level-meter__segment level-meter__segment--on' : 'level-meter__segment'} />)}
    </span>
  );
}

/** 可注入的会话形状：真实 `VoiceSession` 与测试桩都满足（供夹具页渲染语音条）。 */
export interface VoiceSessionLike {
  state(): VoiceState;
  subscribe(listener: (state: VoiceState) => void): () => void;
  setContext(context: import('./session.ts').VoiceContext | null): void;
  join(): Promise<void>;
  leave(): Promise<void>;
  requestMicrophone(): Promise<void>;
  stopMicrophone(): void;
  switchDevice(deviceId: string): Promise<void>;
  enableAudio(): Promise<void>;
  setOutputVolume(volume: number): void;
  setInputVolume(volume: number): void;
}

/** 拥有发布权的发言类窗口（与服务端 `media.ts` 的 SPEAKING_WINDOWS 保持一致） */
const SPEAKING_WINDOW_IDS = ['election_speech', 'speech_round', 'last_words', 'tie_speech'];

/** 听者侧：在当前发言窗口里找出发言窗口实例（无发言窗口时为 null） */
function speakingWindowId(view: RoomSnapshot | null): string | null {
  if (!view) return null;
  return view.windows.find(window => SPEAKING_WINDOW_IDS.includes(window.id))?.instanceId ?? null;
}

/**
 * C 组送达情况的一句话摘要（刻意做得不显眼：小字、灰色、无徽标/告警色）。
 * 分母是"报告过的接收端数"（listeners），不是频道人数；没有任何人上报时不显示。
 */
function deliverySummary(delivery: { delivered: number; blocked: number; silentOutput: number; failed: number; listeners: number } | null): { text: string; title: string } | null {
  if (delivery === null || delivery.listeners === 0) return null;
  const parts: string[] = [];
  if (delivery.blocked > 0) parts.push(`${delivery.blocked} 人未播放`);
  if (delivery.silentOutput > 0) parts.push(`${delivery.silentOutput} 人已静音`);
  if (delivery.failed > 0) parts.push(`${delivery.failed} 人接收失败`);
  const text = delivery.delivered > 0 ? `已送达 ${delivery.delivered}/${delivery.listeners}` : '等待接收确认';
  return { text, title: [`已确认收到：${delivery.delivered}`, `共收到回执：${delivery.listeners}`, ...parts].join(' · ') };
}

export function VoiceBar({ enabled, view, online, activePage, session: injected }: { enabled: boolean; view: RoomSnapshot | null; online: boolean; activePage: boolean; session?: VoiceSessionLike }) {
  const sessionRef = useRef<VoiceSessionLike | null>(null);
  if (sessionRef.current === null) sessionRef.current = injected ?? new VoiceSession();
  const session = sessionRef.current;
  const [state, setState] = useState<VoiceState>(() => session.state());
  // 滑杆拖动过程中先用本地草稿立即生效，松手/失焦时才写偏好，避免每个 input 事件都落一次 localStorage。
  const [draftOutput, setDraftOutput] = useState<number | null>(null);
  const [draftInput, setDraftInput] = useState<number | null>(null);
  const { preferences, update } = usePreferences();
  const playing = view?.room.phase === 'playing' && !!view.gameId;
  const joined = state.connection === 'connected' || state.connection === 'reconnecting';
  const outputVolume = preferences.voiceMuted ? 0 : preferences.voiceOutput;
  const optedOutRef = useRef(false);
  const autoMicKeyRef = useRef<string | null>(null);
  const deliveryWindow = enabled && playing ? speakingWindowId(view) : null;
  useEffect(() => session.subscribe(setState), [session]);
  useEffect(() => {
    session.setContext(enabled && playing ? { roomCode: view.room.code, gameId: view.gameId!, canPublish: view.capabilities.canPublishVoice, readOnly: view.viewer.readOnly, online, activePage, deliveryWindow } : null);
  }, [session, enabled, playing, view?.room.code, view?.gameId, view?.capabilities.canPublishVoice, view?.viewer.readOnly, online, activePage, deliveryWindow]);
  useEffect(() => { if (joined) session.setOutputVolume(outputVolume); }, [session, joined, outputVolume]);
  useEffect(() => { if (state.microphoneEnabled) session.setInputVolume(preferences.voiceInput); }, [session, state.microphoneEnabled, preferences.voiceInput]);
  useEffect(() => { optedOutRef.current = false; autoMicKeyRef.current = null; }, [view?.gameId]);
  // 进对局自动加入语音（订阅即可听）；本人手动离开后本局不再自动重连。
  useEffect(() => {
    if (!enabled || !playing || !activePage || !online || !view || view.viewer.readOnly) return;
    if (optedOutRef.current || state.connection !== 'idle') return;
    void session.join();
  }, [session, enabled, playing, activePage, online, view, state.connection]);
  // 轮到自己发言（服务端授予发布权）时自动开麦；每个发言窗口只自动开一次，手动关麦后不重开。
  useEffect(() => {
    if (!enabled || !playing || !activePage || !online || !view || view.viewer.readOnly) return;
    if (state.connection === 'idle') { autoMicKeyRef.current = null; return; }
    // 只有真正"已连接"才值得记窗口键：重连中的 requestMicrophone() 会被会话忽略（connection !== 'connected'），
    // 若此时就记下，重连成功后本窗口便不会再自动开麦。
    if (state.connection !== 'connected') return;
    if (!preferences.autoMic || !view.capabilities.canPublishVoice) return;
    const speakingWindow = view.windows.find(window => SPEAKING_WINDOW_IDS.includes(window.id));
    const key = `${view.gameId}:${speakingWindow?.instanceId ?? view.public?.day?.currentSpeakerId ?? 'unknown'}`;
    if (state.microphoneEnabled || state.requested) { autoMicKeyRef.current = key; return; }
    if (autoMicKeyRef.current === key) return;
    autoMicKeyRef.current = key;
    void session.requestMicrophone();
  }, [session, enabled, playing, activePage, online, view, preferences.autoMic, state.microphoneEnabled, state.requested, state.connection]);
  useEffect(() => () => { void session.leave(); }, [session]);
  if (!enabled || !playing || (!activePage && state.connection === 'idle')) return null;
  const canOpen = state.connection === 'connected' && activePage && online && view.capabilities.canPublishVoice && !view.viewer.readOnly;
  const display = voiceLevelDisplay({ view, remoteLevel: state.remoteLevel, outputVolume: preferences.voiceOutput, muted: preferences.voiceMuted, showLevels: preferences.voiceLevels });
  const speakerSeat = display.speakingPlayerId === null ? null : view.public?.seats.find(seat => seat.playerId === display.speakingPlayerId)?.seat ?? null;
  // C 组：只有正在开麦的人会拿到服务端下发的送达聚合；显示刻意低调（小字灰色，细节放 title）
  const delivery = state.microphoneEnabled ? deliverySummary(view.private?.voice?.delivery ?? null) : null;
  const commitOutput = () => { if (draftOutput !== null) { update({ voiceOutput: draftOutput }); setDraftOutput(null); } };
  const commitInput = () => { if (draftInput !== null) { update({ voiceInput: draftInput }); setDraftInput(null); } };
  return <section className={`voice-bar${activePage ? '' : ' voice-bar--background'}`} aria-label="公共语音">
    <div className="voice-bar__status"><strong>公共语音</strong><span>{state.connection === 'idle' ? '尚未加入' : state.connection === 'connecting' ? '正在连接…' : state.connection === 'reconnecting' ? '重连中，麦克风已关闭' : state.connection === 'error' ? '连接失败' : view.viewer.readOnly ? '旁听中' : state.microphoneEnabled ? '正在发言' : '已连接 · 只听'}</span></div>
    {state.connection === 'idle' && <button className="button" onClick={() => void session.join()}>{view.viewer.readOnly ? '加入旁听' : '加入语音'}</button>}
    {state.connection === 'error' && <><span className="voice-bar__error">{state.error}</span><button className="button" onClick={() => void session.join()}>重试连接</button></>}
    {joined && <>
      {!view.viewer.readOnly && (state.microphoneEnabled ? <button className="button button--danger" onClick={() => session.stopMicrophone()}>关闭麦克风</button> : <button className="button button--primary" disabled={!canOpen || state.requested} onClick={() => void session.requestMicrophone()}>{state.requested ? '正在开启…' : state.connection === 'reconnecting' ? '重连中…' : view.capabilities.canPublishVoice ? '开启麦克风' : '等待发言权限'}</button>)}
      {state.devices.length > 1 && <label className="voice-bar__device">麦克风<select value={state.activeDeviceId} onChange={event => void session.switchDevice(event.target.value)}>{state.devices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `麦克风 ${index + 1}`}</option>)}</select></label>}
      {state.audioBlocked && <button className="button" onClick={() => void session.enableAudio()}>点击启用声音</button>}
      <button className="text-button" onClick={() => { optedOutRef.current = true; void session.leave(); }}>离开语音</button>
    </>}
    {joined && <div className="voice-bar__levels">
      {ownLevelVisible(state.microphoneEnabled, preferences.voiceLevels) && <span className="voice-bar__own"><LevelMeter label="麦克风音量" level={state.level}/></span>}
      {display.speakingPlayerId !== null && <span className="voice-bar__speaker">{speakerSeat === null ? '' : `${speakerSeat}号 `}{display.muted ? '已静音' : display.showLevel ? `正在发言 · ${display.speakerLevel}%` : '正在发言'}</span>}
      {delivery && <span className="voice-bar__delivery" title={delivery.title}>{delivery.text}</span>}
      <label className="voice-bar__volume">输出音量<input type="range" min={0} max={100} step={5} aria-label="输出音量" value={draftOutput ?? preferences.voiceOutput}
        onChange={event => { const next = Number(event.target.value); setDraftOutput(next); session.setOutputVolume(preferences.voiceMuted ? 0 : next); }}
        onPointerUp={commitOutput} onKeyUp={commitOutput} onBlur={commitOutput}/><span aria-hidden="true">{draftOutput ?? preferences.voiceOutput}</span></label>
      <button className="text-button" aria-pressed={preferences.voiceMuted} onClick={() => update({ voiceMuted: !preferences.voiceMuted })}>{preferences.voiceMuted ? '取消静音' : '静音'}</button>
      {state.microphoneEnabled && <label className="voice-bar__volume">麦克风增益<input type="range" min={0} max={VOICE_INPUT_MAX} step={5} aria-label="麦克风增益" value={draftInput ?? preferences.voiceInput}
        onChange={event => { const next = Number(event.target.value); setDraftInput(next); session.setInputVolume(next); }}
        onPointerUp={commitInput} onKeyUp={commitInput} onBlur={commitInput}/><span aria-hidden="true">{draftInput ?? preferences.voiceInput}</span>{!agcEnabledFor(draftInput ?? preferences.voiceInput) && <em className="voice-bar__agc" title="增益超过 125 时关闭自动增益控制，避免手动放大被压回">AGC 已关闭</em>}</label>}
    </div>}
    {state.microphoneError && <span className="voice-bar__error">{state.microphoneError}</span>}
    {state.notice && <span className="voice-bar__hint">{state.notice}</span>}
    {joined && !view.viewer.readOnly && !view.capabilities.canPublishVoice && <span className="voice-bar__hint">当前未获得发言权限</span>}
    {!activePage && joined && <span className="voice-bar__hint">已离开对局页，麦克风保持关闭</span>}
  </section>;
}
