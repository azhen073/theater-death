import { useEffect, useRef, useState } from 'react';
import type { CommandIntent, CommandReceipt, ReceiptLookup, RoomSnapshot } from '../../../../contracts/v2.ts';
import { get, post } from '../../transport/http.ts';
import { CommandTracker } from './commands.ts';
import type { TrackedCommand } from './commands.ts';

export function useCommands(view: RoomSnapshot, refresh: () => Promise<void>, onError: (error: unknown) => void) {
  const latest = useRef({ view, refresh, onError }); latest.current = { view, refresh, onError };
  const tracker = useRef<CommandTracker | null>(null);
  const [records, setRecords] = useState<TrackedCommand[]>([]);
  const scope = JSON.stringify([view.viewer.userId, view.roomId, view.gameId, view.viewer.memberId, view.viewer.subjectPlayerId, view.viewer.readOnly]);
  useEffect(() => {
    const base = latest.current.view;
    const controller = new CommandTracker(base, () => latest.current.view, {
      send: async intent => {
        const receipt = await post<CommandReceipt>(`/rooms/${base.room.code}/command`, intent);
        void latest.current.refresh(); return receipt;
      },
      lookup: intent => get<ReceiptLookup>(`/rooms/${base.room.code}/games/${encodeURIComponent(intent.gameId)}/receipts/${encodeURIComponent(intent.requestId)}`),
    }, setRecords, error => latest.current.onError(error));
    tracker.current = controller; setRecords([]);
    const timer = setInterval(() => {
      for (const record of controller.list()) if (['unknown', 'not_seen', 'pending'].includes(record.status)) void controller.query(record.intent.requestId);
    }, 2500);
    return () => { clearInterval(timer); controller.dispose(); if (tracker.current === controller) tracker.current = null; };
  }, [scope]);
  useEffect(() => { tracker.current?.reconcile(); }, [view.submissionState, scope]);
  return { records, submit: (intent: CommandIntent) => tracker.current?.submit(intent), query: (id: string) => tracker.current?.query(id), retry: (id: string) => tracker.current?.retry(id) };
}
