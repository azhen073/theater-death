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
  useEffect(() => session.subscribe(setState), [session]);
  useEffect(() => {
    session.setContext(enabled && playing ? { roomCode: view.room.code, gameId: view.gameId!, canPublish: view.capabilities.canPublishVoice, readOnly: view.viewer.readOnly, online, activePage } : null);
  }, [session, enabled, playing, view?.room.code, view?.gameId, view?.capabilities.canPublishVoice, view?.viewer.readOnly, online, activePage]);
  useEffect(() => { if (joined) session.setOutputVolume(outputVolume); }, [session, joined, outputVolume]);
  useEffect(() => { if (state.microphoneEnabled) session.setInputVolume(preferences.voiceInput); }, [session, state.microphoneEnabled, preferences.voiceInput]);
  useEffect(() => () => { void session.leave(); }, [session]);
  if (!enabled || !playing || (!activePage && state.connection === 'idle')) return null;
  const canOpen = joined && activePage && online && view.capabilities.canPublishVoice && !view.viewer.readOnly;
  const display = voiceLevelDisplay({ view, remoteLevel: state.remoteLevel, outputVolume: preferences.voiceOutput, muted: preferences.voiceMuted, showLevels: preferences.voiceLevels });
  const speakerSeat = display.speakingPlayerId === null ? null : view.public?.seats.find(seat => seat.playerId === display.speakingPlayerId)?.seat ?? null;
  const commitOutput = () => { if (draftOutput !== null) { update({ voiceOutput: draftOutput }); setDraftOutput(null); } };
  const commitInput = () => { if (draftInput !== null) { update({ voiceInput: draftInput }); setDraftInput(null); } };
  return <section className={`voice-bar${activePage ? '' : ' voice-bar--background'}`} aria-label="公共语音">
    <div className="voice-bar__status"><strong>公共语音</strong><span>{state.connection === 'idle' ? '尚未加入' : state.connection === 'connecting' ? '正在连接…' : state.connection === 'reconnecting' ? '重连中，麦克风已关闭' : state.connection === 'error' ? '连接失败' : view.viewer.readOnly ? '旁听中' : state.microphoneEnabled ? '正在发言' : '已连接 · 只听'}</span></div>
    {state.connection === 'idle' && <button className="button" onClick={() => void session.join()}>{view.viewer.readOnly ? '加入旁听' : '加入语音'}</button>}
    {state.connection === 'error' && <><span className="voice-bar__error">{state.error}</span><button className="button" onClick={() => void session.join()}>重试连接</button></>}
    {joined && <>
      {!view.viewer.readOnly && (state.microphoneEnabled ? <button className="button button--danger" onClick={() => session.stopMicrophone()}>关闭麦克风</button> : <button className="button button--primary" disabled={!canOpen || state.requested} onClick={() => void session.requestMicrophone()}>{state.requested ? '正在开启…' : view.capabilities.canPublishVoice ? '开启麦克风' : '等待发言权限'}</button>)}
      {state.devices.length > 1 && <label className="voice-bar__device">麦克风<select value={state.activeDeviceId} onChange={event => void session.switchDevice(event.target.value)}>{state.devices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `麦克风 ${index + 1}`}</option>)}</select></label>}
      {state.audioBlocked && <button className="button" onClick={() => void session.enableAudio()}>点击启用声音</button>}
      <button className="text-button" onClick={() => void session.leave()}>离开语音</button>
    </>}
    {joined && <div className="voice-bar__levels">
      {ownLevelVisible(state.microphoneEnabled, preferences.voiceLevels) && <span className="voice-bar__own"><LevelMeter label="麦克风音量" level={state.level}/></span>}
      {display.speakingPlayerId !== null && <span className="voice-bar__speaker">{speakerSeat === null ? '' : `${speakerSeat}号 `}{display.muted ? '已静音' : display.showLevel ? `正在发言 · ${display.speakerLevel}%` : '正在发言'}</span>}
      <label className="voice-bar__volume">输出音量<input type="range" min={0} max={100} step={5} aria-label="输出音量" value={draftOutput ?? preferences.voiceOutput}
        onChange={event => { const next = Number(event.target.value); setDraftOutput(next); session.setOutputVolume(preferences.voiceMuted ? 0 : next); }}
        onPointerUp={commitOutput} onKeyUp={commitOutput} onBlur={commitOutput}/><span aria-hidden="true">{draftOutput ?? preferences.voiceOutput}</span></label>
      <button className="text-button" aria-pressed={preferences.voiceMuted} onClick={() => update({ voiceMuted: !preferences.voiceMuted })}>{preferences.voiceMuted ? '取消静音' : '静音'}</button>
      {state.microphoneEnabled && <label className="voice-bar__volume">麦克风增益<input type="range" min={0} max={VOICE_INPUT_MAX} step={5} aria-label="麦克风增益" value={draftInput ?? preferences.voiceInput}
        onChange={event => { const next = Number(event.target.value); setDraftInput(next); session.setInputVolume(next); }}
        onPointerUp={commitInput} onKeyUp={commitInput} onBlur={commitInput}/><span aria-hidden="true">{draftInput ?? preferences.voiceInput}</span>{!agcEnabledFor(draftInput ?? preferences.voiceInput) && <em className="voice-bar__agc" title="增益超过 110 时关闭自动增益控制，避免手动放大被压回">AGC 已关闭</em>}</label>}
    </div>}
    {state.microphoneError && <span className="voice-bar__error">{state.microphoneError}</span>}
    {joined && !view.viewer.readOnly && !view.capabilities.canPublishVoice && <span className="voice-bar__hint">当前未获得发言权限</span>}
    {!activePage && joined && <span className="voice-bar__hint">已离开对局页，麦克风保持关闭</span>}
  </section>;
}
