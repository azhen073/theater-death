import { DatabaseSync } from 'node:sqlite';
import type { GameEvent } from '../engine/events.ts';

export interface StoredEvent {
  readonly seq: number;
  readonly dayNumber: number;
  readonly stage: number;
  readonly type: string;
  readonly payload: unknown;
  readonly visibility: unknown;
}

export interface StoredMessage {
  readonly id: number;
  readonly channel: string;
  readonly senderId: string;
  readonly text: string;
  readonly at: number;
  readonly eventSeq: number;
}

export interface StoredRoomRecord {
  readonly gameId: string;
  readonly code: string;
  readonly createdAt: number;
  readonly ruleset: unknown;
}

export interface LogStore {
  appendEvents(gameId: string, events: readonly GameEvent[]): void;
  appendMessage(gameId: string, message: StoredMessage): void;
  /** 保存房间创建时的板子快照（含实验模式值，T-49 / R-54） */
  recordRoom(room: StoredRoomRecord): void;
  getRoom(gameId: string): StoredRoomRecord | null;
  listEvents(gameId: string, sinceSeq: number): StoredEvent[];
  listMessages(gameId: string, sinceId: number): StoredMessage[];
  close(): void;
}

export function createLogStore(path: string): LogStore {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      game_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      day_number INTEGER NOT NULL,
      stage INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      visibility TEXT NOT NULL,
      PRIMARY KEY (game_id, seq)
    );
    CREATE TABLE IF NOT EXISTS messages (
      game_id TEXT NOT NULL,
      id INTEGER NOT NULL,
      channel TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      text TEXT NOT NULL,
      at INTEGER NOT NULL,
      event_seq INTEGER NOT NULL,
      PRIMARY KEY (game_id, id)
    );
    CREATE TABLE IF NOT EXISTS rooms (
      game_id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ruleset TEXT NOT NULL
    );
  `);

  const insertEvent = db.prepare(
    'INSERT OR REPLACE INTO events (game_id, seq, day_number, stage, type, payload, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insertMessage = db.prepare(
    'INSERT OR REPLACE INTO messages (game_id, id, channel, sender_id, text, at, event_seq) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const selectEvents = db.prepare(
    'SELECT seq, day_number, stage, type, payload, visibility FROM events WHERE game_id = ? AND seq > ? ORDER BY seq ASC',
  );
  const selectMessages = db.prepare(
    'SELECT id, channel, sender_id, text, at, event_seq FROM messages WHERE game_id = ? AND id > ? ORDER BY id ASC',
  );
  const insertRoom = db.prepare(
    'INSERT OR REPLACE INTO rooms (game_id, code, created_at, ruleset) VALUES (?, ?, ?, ?)',
  );
  const selectRoom = db.prepare(
    'SELECT game_id, code, created_at, ruleset FROM rooms WHERE game_id = ?',
  );

  return {
    appendEvents(gameId, events) {
      for (const event of events) {
        insertEvent.run(
          gameId,
          event.seq,
          event.dayNumber,
          event.stage,
          event.type,
          JSON.stringify(event.payload),
          JSON.stringify(event.visibility),
        );
      }
    },
    appendMessage(gameId, message) {
      insertMessage.run(
        gameId,
        message.id,
        message.channel,
        message.senderId,
        message.text,
        message.at,
        message.eventSeq,
      );
    },
    recordRoom(room) {
      insertRoom.run(room.gameId, room.code, room.createdAt, JSON.stringify(room.ruleset));
    },
    getRoom(gameId) {
      const row = selectRoom.get(gameId) as Record<string, unknown> | undefined;
      if (row === undefined) {
        return null;
      }
      return {
        gameId: row.game_id as string,
        code: row.code as string,
        createdAt: row.created_at as number,
        ruleset: JSON.parse(row.ruleset as string) as unknown,
      };
    },
    listEvents(gameId, sinceSeq) {
      const rows = selectEvents.all(gameId, sinceSeq) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        seq: row.seq as number,
        dayNumber: row.day_number as number,
        stage: row.stage as number,
        type: row.type as string,
        payload: JSON.parse(row.payload as string) as unknown,
        visibility: JSON.parse(row.visibility as string) as unknown,
      }));
    },
    listMessages(gameId, sinceId) {
      const rows = selectMessages.all(gameId, sinceId) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: row.id as number,
        channel: row.channel as string,
        senderId: row.sender_id as string,
        text: row.text as string,
        at: row.at as number,
        eventSeq: row.event_seq as number,
      }));
    },
    close() {
      db.close();
    },
  };
}
