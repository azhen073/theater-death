/** 本地玩家标记：只写 localStorage，绝不进入命令/事件流，也不上传服务端。 */
export const PLAYER_MARK_LABELS = ['可疑', '可信', '跳死神', '跳魂灵', '跳天理'] as const;
export type PlayerMarkLabel = typeof PLAYER_MARK_LABELS[number];
export const PLAYER_MARK_COLORS = ['red', 'gold', 'green', 'blue'] as const;
export type PlayerMarkColor = typeof PLAYER_MARK_COLORS[number];
export const PLAYER_MARK_NOTE_MAX = 20;

export interface PlayerMark { label: PlayerMarkLabel | null; color: PlayerMarkColor | null; note: string }

export interface PlayerMarkStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function playerMarkKey(roomId: string, gameId: string, playerId: string): string {
  return `theater-death-marks-v1:${roomId}:${gameId}:${playerId}`;
}

export function parsePlayerMark(value: unknown): PlayerMark | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const label = (PLAYER_MARK_LABELS as readonly unknown[]).includes(raw.label) ? raw.label as PlayerMarkLabel : null;
  const color = (PLAYER_MARK_COLORS as readonly unknown[]).includes(raw.color) ? raw.color as PlayerMarkColor : null;
  const note = typeof raw.note === 'string' ? raw.note.slice(0, PLAYER_MARK_NOTE_MAX) : '';
  if (!label && !color && !note) return null;
  return { label, color, note };
}

export function readPlayerMark(store: PlayerMarkStore, key: string): PlayerMark | null {
  try { return parsePlayerMark(JSON.parse(store.getItem(key) ?? 'null')); } catch { return null; }
}

/** 空标记（无标签/色点/备注）按清除处理，返回 false 仅表示存储不可用。 */
export function writePlayerMark(store: PlayerMarkStore, key: string, mark: PlayerMark | null): boolean {
  try {
    if (!mark || (!mark.label && !mark.color && !mark.note)) store.removeItem(key);
    else store.setItem(key, JSON.stringify(mark));
    return true;
  } catch {
    return false;
  }
}

export function playerMarkTooltip(mark: PlayerMark): string {
  return ['我的标记', mark.label, mark.note].filter(part => part).join(' · ') + '（仅保存在本机）';
}
