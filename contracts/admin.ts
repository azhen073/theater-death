export type AdminAccountStatus = 'active' | 'disabled';
export interface AdminRoomSummary { roomId: string; roomCode: string; phase: 'lobby' | 'playing' | 'review'; kind: 'formal' | 'public_spectator' | 'private_spectator' | null }
export interface AdminAccountSummary {
  userId: string; uid: string; nickname: string; createdAt: number; disabledAt: number | null; status: AdminAccountStatus;
  avatarUrl: string | null; profileVersion: number; activeSessionCount: number; room: AdminRoomSummary | null; deletable: boolean; deleteReason: string | null;
}
export interface AdminAuditEntry { id: number; action: string; targetType: 'account' | 'invitation' | 'auth'; targetId: string | null; at: number; details: Record<string, string | number | boolean | null> }
export interface AdminSummary { accounts: { total: number; active: number; disabled: number; activeSessions: number }; registrationEnabled: boolean; avatars: { total: number; referenced: number }; recentActions: AdminAuditEntry[] }
export interface AdminPage<T> { items: T[]; page: number; pageSize: number; total: number }
