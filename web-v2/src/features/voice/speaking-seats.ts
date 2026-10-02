import { useSyncExternalStore } from 'react';
import { activeSpeakingSeats } from '../../presentation/voice-levels.ts';

/**
 * 「谁在说话」的本机临时状态。
 *
 * 数据来源只有本机的 Agora 音量指示（不上报服务端、不入日志与复盘），用于亮光环：
 * 舞台座位（对局内的自由发言阶段，服务端 `currentSpeakerId` 之外的情况）与
 * 大厅 / 复盘的成员卡（房间频道，Q-12）。
 *
 * 存的是**语音主体**：对局频道里是 `playerId`（座位比对），房间频道里是 `memberId`
 * （成员卡比对）——两种相位互斥，消费方按自己所处相位比对即可。放在模块级是因为
 * 语音条与舞台/大厅是同层兄弟节点。
 */
let current: readonly string[] = [];
const listeners = new Set<() => void>();
const held = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;
const NO_LEVELS: ReadonlyMap<number, number> = new Map();

export function subscribeSpeakingSeats(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function speakingSeatsSnapshot(): readonly string[] {
  return current;
}

function publish(next: readonly string[]): void {
  if (next.length === current.length && next.every((value, index) => value === current[index])) return;
  current = next;
  for (const listener of listeners) listener();
}

/**
 * 保持期到点后必须再算一次：安静下来后音量指示可能不再回调，
 * 只靠采样清理会让光环永久停在那里。
 */
function schedulePrune(): void {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (held.size === 0) return;
  const next = Math.min(...held.values());
  timer = setTimeout(() => {
    timer = null;
    publish(activeSpeakingSeats(held, NO_LEVELS, {}, Date.now()));
    schedulePrune();
  }, Math.max(1, next - Date.now()));
}

/** 用一次音量采样更新光环；`uids` 是服务端下发的频道 uid → playerId 映射。 */
export function updateSpeakingSeats(levels: ReadonlyMap<number, number>, uids: Readonly<Record<string, string>>, now: number): void {
  publish(activeSpeakingSeats(held, levels, uids, now));
  schedulePrune();
}

/** 阶段结束/离开对局时清空（不顺延到其他阶段）。 */
export function clearSpeakingSeats(): void {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  held.clear();
  publish([]);
}

/** 舞台订阅用；无外部状态源，服务端渲染时返回空数组。 */
export function useSpeakingSeats(): readonly string[] {
  return useSyncExternalStore(subscribeSpeakingSeats, speakingSeatsSnapshot, () => current);
}
