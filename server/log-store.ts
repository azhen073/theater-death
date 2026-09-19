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
  readonly messageId?: string;
  readonly clientMessageId?: string;
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
  recordPersistentRoom(room: { roomId: string; code: string; createdAt: number; ruleset: unknown }): void;
  recordMatch(match: { gameId: string; roomId: string; startedAt: number }): void;
  finishMatch(gameId: string, status: 'completed' | 'aborted', at: number): void;
  listMatches(roomId: string): Array<{ gameId: string; roomId: string; startedAt: number; endedAt: number | null; status: 'playing' | 'completed' | 'aborted' }>;
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
  const schema = Number(db.prepare('PRAGMA user_version').get()!.user_version);
  if (schema > 1) { db.close(); throw new Error('unsupported_audit_schema'); }
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
    CREATE TABLE IF NOT EXISTS persistent_rooms (
      room_id TEXT PRIMARY KEY, code TEXT NOT NULL, created_at INTEGER NOT NULL, ruleset TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS matches (
      game_id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES persistent_rooms(room_id),
      started_at INTEGER NOT NULL, ended_at INTEGER,
      status TEXT NOT NULL CHECK(status IN ('playing','completed','aborted'))
    );
    CREATE INDEX IF NOT EXISTS matches_room ON matches(room_id);
  `);

  if (schema === 0) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('ALTER TABLE messages ADD COLUMN message_id TEXT; ALTER TABLE messages ADD COLUMN client_message_id TEXT; PRAGMA user_version = 1; COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }

  const insertEvent = db.prepare(
    'INSERT OR REPLACE INTO events (game_id, seq, day_number, stage, type, payload, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insertMessage = db.prepare(
    'INSERT OR REPLACE INTO messages (game_id, id, channel, sender_id, text, at, event_seq, message_id, client_message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const selectEvents = db.prepare(
    'SELECT seq, day_number, stage, type, payload, visibility FROM events WHERE game_id = ? AND seq > ? ORDER BY seq ASC',
  );
  const selectMessages = db.prepare(
    'SELECT id, channel, sender_id, text, at, event_seq, message_id, client_message_id FROM messages WHERE game_id = ? AND id > ? ORDER BY id ASC',
  );
  const insertRoom = db.prepare(
    'INSERT OR REPLACE INTO rooms (game_id, code, created_at, ruleset) VALUES (?, ?, ?, ?)',
  );
  const selectRoom = db.prepare(
    'SELECT game_id, code, created_at, ruleset FROM rooms WHERE game_id = ?',
  );

  return {
    recordPersistentRoom(room) {
      db.prepare('INSERT INTO persistent_rooms VALUES(?,?,?,?)').run(room.roomId, room.code, room.createdAt, JSON.stringify(room.ruleset));
    },
    recordMatch(match) {
      db.prepare("INSERT INTO matches VALUES(?,?,?,NULL,'playing')").run(match.gameId, match.roomId, match.startedAt);
    },
    finishMatch(gameId, status, at) {
      db.prepare("UPDATE matches SET status=?,ended_at=? WHERE game_id=? AND status='playing'").run(status, at, gameId);
    },
    listMatches(roomId) {
      return db.prepare('SELECT * FROM matches WHERE room_id=? ORDER BY started_at,game_id').all(roomId).map((r) => ({
        gameId: String(r.game_id), roomId: String(r.room_id), startedAt: Number(r.started_at), endedAt: r.ended_at === null ? null : Number(r.ended_at), status: r.status as 'playing' | 'completed' | 'aborted',
      }));
    },
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
        message.messageId ?? null,
        message.clientMessageId ?? null,
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
        ...(row.message_id === null ? {} : { messageId: row.message_id as string }),
        ...(row.client_message_id === null ? {} : { clientMessageId: row.client_message_id as string }),
      }));
    },
    close() {
      db.close();
    },
  };
}
