import type { RoomAction, RoomMemberDTO, RoomSnapshot } from '../../../../contracts/v2.ts';

export function canManageMember(view: RoomSnapshot, action: 'kick' | 'transfer-host', memberId: string): boolean {
  const target = [...view.room.formalMembers, ...view.room.spectators].find(member => member.memberId === memberId);
  if (!target || target.memberId === view.viewer.memberId) return false;
  if (action === 'transfer-host') return view.capabilities.room.transferHost.allowed && target.kind === 'formal' && target.presence === 'online';
  return target.kind === 'formal' ? view.capabilities.room.kickFormal.allowed : view.capabilities.room.kickSpectator.allowed;
}

export function roomActionAllowed(view: RoomSnapshot, action: RoomAction): boolean {
  return view.capabilities.room[action].allowed;
}

export function memberLabel(member: RoomMemberDTO, viewerId: string): string {
  return member.nickname + (member.userId === viewerId ? '（你）' : '') + (member.isHost ? ' · 房主' : '');
}

/** Exit semantics follow phase and membership, never hidden role/life information. */
export function roomExitPresentation(view: RoomSnapshot) {
  const formal = view.viewer.kind === 'formal';
  if (view.room.phase === 'playing' && formal) return {
    label: '暂离对局', title: '暂离对局？',
    description: `对局继续计时，本局身份与席位保留。房间仍存在时，可用原账号重新进入；错过的行动不会补开。${view.viewer.isHost ? '房主暂离不会解散房间；若有其他在线正式玩家，将自动接任房主。' : ''}`,
  };
  if (view.room.phase === 'review') return {
    label: '离开房间', title: '离开房间？',
    description: view.viewer.isHost
      ? '你是房主：退出将立即解散房间，其他成员的复盘同时关闭、房间码立即失效。账号保持登录。'
      : `退出后返回首页，账号保持登录；其他成员可继续复盘。${formal ? '房间和本局复盘仍存在时，可用原账号回来查看。最后一名正式玩家退出后，房间立即关闭，剩余观众也会退出。' : '若房间仍存在，可以重新进入公开观战；私人第二屏需重新获得授权。'}`,
  };
  return {
    label: '离开房间', title: '离开房间？',
    description: view.room.phase === 'lobby'
      ? view.viewer.isHost
        ? '你是房主：退出将立即解散房间，所有成员回到入口页、房间码立即失效。账号保持登录。'
        : '你将离开当前房间，并释放正式名额（若有）。账号保持登录。'
      : '你将退出观战并返回首页，账号保持登录。私人第二屏需重新获得授权。',
  };
}

export function roomExitMessage(view: RoomSnapshot, seatRetained: boolean) {
  if (view.room.phase === 'review') return '你已离开房间，账号保持登录。';
  return seatRetained ? '你已暂离对局。本局席位仍保留，房间存在时可用原账号恢复。' : '你已离开房间。';
}
