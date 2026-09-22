import { useEffect, useRef, useState } from 'react';
import type { RoomSnapshot, WindowDTO } from '../../../../contracts/v2.ts';
import { formatCountdown } from '../../presentation/labels.ts';
import '../../styles/speech-attention.css';

export function SpeechAttention({ view, active, window: speechWindow, remaining }: {
  view: RoomSnapshot; active: boolean; window: WindowDTO | null;
  remaining: (deadline: number) => number | null;
}) {
  const day = view.public?.day;
  const speaker = view.public?.seats.find(seat => seat.playerId === day?.currentSpeakerId);
  const own = view.viewer.kind === 'formal' && !view.viewer.readOnly && speaker?.playerId === view.viewer.subjectPlayerId;
  const [sound, setSound] = useState(false);
  const [audioError, setAudioError] = useState('');
  const context = useRef<AudioContext | null>(null);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const publicPhase = JSON.stringify([view.roomId, view.gameId, view.public?.dayNumber, view.public?.stage, view.public?.phase === 'night' ? 'night' : 'day']);
  const ownCue = own && speaker && speechWindow ? JSON.stringify([publicPhase, speaker.playerId, speechWindow.instanceId, day?.speechPreparing]) : null;
  const previous = useRef<{ phase: string; ownCue: string | null; active: boolean } | null>(null);
  const ready = active && visible;

  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  useEffect(() => () => { void context.current?.close(); context.current = null; }, []);

  useEffect(() => {
    const old = previous.current;
    previous.current = { phase: publicPhase, ownCue, active: ready };
    const cue = ownCue && old?.ownCue !== ownCue ? ownCue : old?.phase !== publicPhase ? publicPhase : null;
    if (!cue) return;
    try {
      const key = 'theater-death:attention-sound:v1:' + cue;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, 'seen');
    } catch { return; }
    if (!old?.active || !ready || !sound || context.current?.state !== 'running') return;
    const audio = context.current;
    // Local playback only. No microphone, voice session, or game command is touched.
    [523.25, 783.99].forEach((frequency, index) => {
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      const start = audio.currentTime + index * .12;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(.035, start + .025);
      gain.gain.exponentialRampToValueAtTime(.001, start + .2);
      oscillator.connect(gain); gain.connect(audio.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start); oscillator.stop(start + .22);
    });
  }, [publicPhase, ownCue, ready, sound]);

  const toggleSound = async () => {
    if (sound) { setSound(false); await context.current?.suspend(); return; }
    try {
      context.current ??= new AudioContext();
      await context.current.resume();
      if (context.current.state !== 'running') throw new Error('blocked');
      setSound(true); setAudioError('');
    } catch { setSound(false); setAudioError('浏览器未允许提示音；文字提醒仍然可用。'); }
  };

  return <section className={`speech-attention ${own ? 'speech-attention--own' : ''}`} aria-label="发言与提醒">
    {speaker && <div className="speech-attention__speaker">
      <strong>{own ? '轮到你了 · ' : ''}{day?.speechPreparing ? '即将发言' : '正在发言'}：{speaker.seat}号 {speaker.nickname}</strong>
      {speechWindow && <span role="timer" aria-label={day?.speechPreparing ? '发言准备剩余时间' : '发言剩余时间'}>{formatCountdown(remaining(speechWindow.closesAt))}</span>}
      {own && day?.speechPreparing && <small>最多准备 15 秒，倒计时结束自动开始；可在舞台行动中提前开始。</small>}
    </div>}
    <button type="button" className="text-button" aria-pressed={sound} onClick={() => void toggleSound()} aria-label="阶段与本人发言提示音">提示音：{sound ? '开启' : '关闭'}<small>仅本页，刷新后关闭</small></button>
    {audioError && <small role="status">{audioError}</small>}
  </section>;
}
