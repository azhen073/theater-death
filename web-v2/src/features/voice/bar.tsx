import { useEffect, useRef, useState } from 'react';
import type { RoomSnapshot } from '../../../../contracts/v2.ts';
import { VoiceSession, type VoiceState } from './session.ts';

export function VoiceBar({ enabled, view, online, activePage }: { enabled: boolean; view: RoomSnapshot | null; online: boolean; activePage: boolean }) {
  const sessionRef = useRef<VoiceSession | null>(null);
  if (sessionRef.current === null) sessionRef.current = new VoiceSession();
  const session = sessionRef.current;
  const [state, setState] = useState<VoiceState>(() => session.state());
  const playing = view?.room.phase === 'playing' && !!view.gameId;
  useEffect(() => session.subscribe(setState), [session]);
  useEffect(() => {
    session.setContext(enabled && playing ? { roomCode: view.room.code, gameId: view.gameId!, canPublish: view.capabilities.canPublishVoice, readOnly: view.viewer.readOnly, online, activePage } : null);
  }, [session, enabled, playing, view?.room.code, view?.gameId, view?.capabilities.canPublishVoice, view?.viewer.readOnly, online, activePage]);
  useEffect(() => () => { void session.leave(); }, [session]);
  if (!enabled || !playing || (!activePage && state.connection === 'idle')) return null;
  const joined = state.connection === 'connected' || state.connection === 'reconnecting';
  const canOpen = joined && activePage && online && view.capabilities.canPublishVoice && !view.viewer.readOnly;
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
    {state.microphoneError && <span className="voice-bar__error">{state.microphoneError}</span>}
    {joined && !view.viewer.readOnly && !view.capabilities.canPublishVoice && <span className="voice-bar__hint">当前未获得发言权限</span>}
    {!activePage && joined && <span className="voice-bar__hint">已离开对局页，麦克风保持关闭</span>}
  </section>;
}
