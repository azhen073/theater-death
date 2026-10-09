import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CatalogDTO } from '../contracts/catalog.ts';
import type { RoomSnapshot } from '../contracts/v2.ts';
import { BADGE_TONES, badge, badgeStripLabel, isSplitStrip, type BadgeTone } from '../web-v2/src/presentation/badges.ts';
import { factionKey, factionLabel } from '../web-v2/src/presentation/faction.ts';
import { seatBadges } from '../web-v2/src/features/game/seat-badges.ts';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/contract-2.1/${name}`, import.meta.url), 'utf8')) as T;
}

const base = fixture<RoomSnapshot>('night-spirit-full.json');
const catalog = fixture<CatalogDTO>('catalog-full.json');
const selfSeat = base.private!.self.seat;
const peerSeat = base.private!.knowledge.spiritSeats[0]!;

function view(): RoomSnapshot {
  const next = structuredClone(base);
  next.public!.sheriff = { enabled: true, holderId: null };
  return next;
}

function seat(view: RoomSnapshot, seatNumber: number) {
  const found = view.public!.seats.find(item => item.seat === seatNumber);
  if (!found) throw new Error(`夹具缺少 ${seatNumber} 号座位`);
  return found;
}

function seatId(view: RoomSnapshot, seatNumber: number): string {
  return seat(view, seatNumber).playerId;
}

describe('徽标通用模型（可复用层）', () => {
  it('每个色调都注册了默认文案，且色调类名由色调拼出', () => {
    for (const tone of Object.keys(BADGE_TONES) as BadgeTone[]) {
      expect(BADGE_TONES[tone].label.length).toBeGreaterThan(0);
      expect(badge(tone)).toMatchObject({ id: tone, tone, label: BADGE_TONES[tone].label });
    }
  });

  it('文案与标题可覆盖，且不覆盖时不含 title 字段', () => {
    expect(badge('spirit', { label: '同伴', title: '已知魂灵' })).toEqual({ id: 'spirit', tone: 'spirit', label: '同伴', title: '已知魂灵' });
    expect('title' in badge('spirit')).toBe(false);
  });

  it('多枚徽标判定为等分底色框，单枚/空不是', () => {
    expect(isSplitStrip([])).toBe(false);
    expect(isSplitStrip([badge('spirit')])).toBe(false);
    expect(isSplitStrip([badge('sheriff'), badge('spirit')])).toBe(true);
  });

  it('无障碍名用顿号分隔（避免读屏连读）', () => {
    expect(badgeStripLabel([])).toBe('');
    expect(badgeStripLabel([badge('sheriff')])).toBe('天理');
    expect(badgeStripLabel([badge('sheriff'), badge('spirit')])).toBe('天理、魂灵');
  });
});

describe('座位徽标派生：天理（公开）+ 魂灵（私有知识）', () => {
  it('普通座位没有徽标', () => {
    const v = view();
    const plain = v.public!.seats.find(item => item.seat !== peerSeat)!;
    expect(seatBadges(v, plain)).toEqual([]);
  });

  it('天理持有者显示天理徽标（公开信息，无需私有知识）', () => {
    const v = view();
    v.public!.sheriff = { enabled: true, holderId: seatId(v, peerSeat) };
    v.private!.knowledge.spiritSeats = [];
    expect(seatBadges(v, seat(v, peerSeat)).map(item => item.tone)).toEqual(['sheriff']);
  });

  it('已知魂灵显示魂灵徽标（同伴 13 号）', () => {
    const v = view();
    expect(seatBadges(v, seat(v, peerSeat)).map(item => item.tone)).toEqual(['spirit']);
    expect(seatBadges(v, seat(v, peerSeat))[0]!.label).toBe('魂灵');
  });

  it('自己座位不会出现魂灵徽标（服务端已排除本人）', () => {
    const v = view();
    expect(v.private!.knowledge.spiritSeats).not.toContain(selfSeat);
    expect(seatBadges(v, seat(v, selfSeat))).toEqual([]);
  });

  it('同时是天理与魂灵时顺序固定为 天理 → 魂灵（即底色框左半 / 右半）', () => {
    const v = view();
    v.public!.sheriff = { enabled: true, holderId: seatId(v, peerSeat) };
    const items = seatBadges(v, seat(v, peerSeat));
    expect(items.map(item => item.tone)).toEqual(['sheriff', 'spirit']);
    expect(items.map(item => item.label)).toEqual(['天理', '魂灵']);
    expect(badgeStripLabel(items)).toBe('天理、魂灵');
    expect(isSplitStrip(items)).toBe(true);
  });

  it('其它身份（门先生）没有私有知识 → 只可能出现公开的天理徽标', () => {
    const door = fixture<RoomSnapshot>('night-door-full.json');
    const seats = door.public!.seats;
    for (const item of seats) expect(seatBadges(door, item)).toEqual([]);
    door.public!.sheriff = { enabled: true, holderId: seats[0]!.playerId };
    expect(seatBadges(door, seats[0]!).map(badgeItem => badgeItem.tone)).toEqual(['sheriff']);
  });

  it('只读视角沿用服务端下发的私有知识（第二屏可见绑定玩家的已知魂灵）', () => {
    const v = view();
    v.viewer = { ...v.viewer, kind: 'private_spectator', readOnly: true };
    expect(seatBadges(v, seat(v, peerSeat)).map(item => item.tone)).toEqual(['spirit']);
  });
});

describe('本人座位身份徽标（身份 → 天理 → 魂灵）', () => {
  it('本人座位显示身份徽标，名称取自 catalog', () => {
    const v = view();
    const items = seatBadges(v, seat(v, selfSeat), catalog);
    expect(items.map(item => item.tone)).toEqual(['identity']);
    expect(items[0]!.label).toBe('魂灵');
  });

  it('身份徽标只出现在本人座位，其它座位没有', () => {
    const v = view();
    const others = v.public!.seats.filter(item => item.seat !== selfSeat);
    for (const other of others) {
      expect(seatBadges(v, other, catalog).some(item => item.tone === 'identity')).toBe(false);
    }
  });

  it('本人同时是天理时顺序为 身份 → 天理', () => {
    const v = view();
    v.public!.sheriff = { enabled: true, holderId: seatId(v, selfSeat) };
    expect(seatBadges(v, seat(v, selfSeat), catalog).map(item => item.tone)).toEqual(['identity', 'sheriff']);
    // 同伴同时是天理时仍是 天理 → 魂灵（同伴没有身份徽标）
    v.public!.sheriff = { enabled: true, holderId: seatId(v, peerSeat) };
    expect(seatBadges(v, seat(v, peerSeat), catalog).map(item => item.tone)).toEqual(['sheriff', 'spirit']);
  });

  it('第二屏（只读绑定视角）同样显示绑定玩家的身份徽标', () => {
    const v = view();
    v.viewer = { ...v.viewer, kind: 'private_spectator', readOnly: true };
    expect(seatBadges(v, seat(v, selfSeat), catalog).map(item => item.tone)).toEqual(['identity']);
  });

  it('公开观众没有私有视图 → 没有身份徽标', () => {
    const v = view();
    v.private = null;
    v.viewer = { ...v.viewer, kind: 'public_spectator', readOnly: true, subjectPlayerId: null };
    for (const item of v.public!.seats) expect(seatBadges(v, item, catalog)).toEqual([]);
  });

  it('catalog 查不到该身份、或未传 catalog 时不显示（不露出 roleId 原文）', () => {
    const v = view();
    v.private!.self.roleId = 'unknown_role' as typeof v.private.self.roleId;
    expect(seatBadges(v, seat(v, selfSeat), catalog)).toEqual([]);
    const noCatalog = view();
    expect(seatBadges(noCatalog, seat(noCatalog, selfSeat))).toEqual([]);
    expect(seatBadges(noCatalog, seat(noCatalog, selfSeat), null)).toEqual([]);
  });

  it('身份徽标带阵营（魂灵＝死神阵营、门先生＝人类阵营），供统一配色使用', () => {
    const spirit = view();
    expect(seatBadges(spirit, seat(spirit, selfSeat), catalog)[0]).toMatchObject({ tone: 'identity', label: '魂灵', faction: 'death_faction' });
    const door = fixture<RoomSnapshot>('night-door-full.json');
    const doorSelf = door.public!.seats.find(item => item.playerId === door.viewer.subjectPlayerId)!;
    expect(seatBadges(door, doorSelf, catalog)[0]).toMatchObject({ tone: 'identity', label: '门先生', faction: 'human' });
  });
});

describe('阵营配色口径（统一来源）', () => {
  it('阵营 → CSS 修饰后缀与中文名', () => {
    expect(factionKey('human')).toBe('human');
    expect(factionKey('death_faction')).toBe('death');
    expect(factionKey(null)).toBeNull();
    expect(factionKey(undefined)).toBeNull();
    expect(factionLabel('human')).toBe('人类阵营');
    expect(factionLabel('death_faction')).toBe('死神阵营');
    expect(factionLabel(null)).toBe('');
  });

  it('catalog 里每个身份都带可识别的阵营', () => {
    for (const role of catalog.roles) {
      expect(factionKey(role.faction)).not.toBeNull();
      expect(factionLabel(role.faction)).not.toBe('');
    }
    expect(catalog.roles.filter(role => role.faction === 'death_faction').map(role => role.roleId).sort()).toEqual(['death', 'mourner', 'spirit']);
  });
});
