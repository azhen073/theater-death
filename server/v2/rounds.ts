import { ReceiptStore } from '../receipts.ts';
import type { AccountSession } from './account-store.ts';
import type { RoomDirectory } from './room-directory.ts';
import type { RoomGovernance } from './governance.ts';
import type { StableRoom } from './stable-room.ts';
import { requireMatch } from './screen-grants.ts';
import { ApiError } from './errors.ts';
import { ChatReceipts } from './chat-receipts.ts';

export class RoomRounds {
  readonly directory: RoomDirectory;
  readonly governance: RoomGovernance;
  constructor(directory: RoomDirectory, governance: RoomGovernance) { this.directory = directory; this.governance = governance; }
  endReview(room: StableRoom, session: AccountSession, gameId: string) {
    return this.directory.mutate(room, () => {
      this.governance.host(room, session);
      requireMatch(room, gameId);
      if (room.phase !== 'review') throw new ApiError(409, 'review_required');
      room.recordCompletion();
      room.access!.close();
      this.directory.deps.registry.disposeRoom(gameId);
      this.directory.deps.closedMatch?.(gameId);
      room.runtime = null; room.access = null; room.participants.clear();
      room.matchStartedAt = null; room.matchEndedAt = null;
      room.receipts = new ReceiptStore();
      room.chatReceipts = new ChatReceipts();
      room.submissions.clear();
      for (const member of room.members.values()) {
        member.ready = false;
        if (member.kind === 'private_spectator') member.kind = 'public_spectator';
      }
      this.directory.deps.control(room, null, 'review_ended');
      return { roomId: room.roomId, roomCode: room.code, gameId: null, endedGameId: gameId };
    });
  }
}
