import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogStore } from '../server/log-store.ts';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('audit schema migration', () => {
  it('upgrades legacy user_version 0 in place, preserves rows, adds stable message ids, and reopens idempotently', () => {
    const directory = mkdtempSync(join(tmpdir(), 'theater-death-audit-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'audit.sqlite');
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      PRAGMA user_version = 0;
      CREATE TABLE events (
        game_id TEXT NOT NULL, seq INTEGER NOT NULL, day_number INTEGER NOT NULL,
        stage INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL,
        visibility TEXT NOT NULL, PRIMARY KEY (game_id, seq)
      );
      CREATE TABLE messages (
        game_id TEXT NOT NULL, id INTEGER NOT NULL, channel TEXT NOT NULL,
        sender_id TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL,
        event_seq INTEGER NOT NULL, PRIMARY KEY (game_id, id)
      );
      INSERT INTO events VALUES ('game-legacy', 1, 1, 1, 'legacy_event', '{}', '{"kind":"public"}');
      INSERT INTO messages VALUES ('game-legacy', 1, 'public', 'player-1', 'legacy message', 1000, 1);
    `);
    legacy.close();

    const first = createLogStore(path);
    expect(first.listEvents('game-legacy', 0)).toEqual([expect.objectContaining({ seq: 1, type: 'legacy_event' })]);
    expect(first.listMessages('game-legacy', 0)).toEqual([{
      id: 1, channel: 'public', senderId: 'player-1', text: 'legacy message', at: 1000, eventSeq: 1,
    }]);
    first.appendMessage('game-legacy', {
      id: 2, channel: 'public', senderId: 'player-1', text: 'new message', at: 1001, eventSeq: 1,
      messageId: 'message-stable-2', clientMessageId: 'client-stable-2',
    });
    first.close();

    const reopened = createLogStore(path);
    expect(reopened.listMessages('game-legacy', 0)).toEqual([
      { id: 1, channel: 'public', senderId: 'player-1', text: 'legacy message', at: 1000, eventSeq: 1 },
      { id: 2, channel: 'public', senderId: 'player-1', text: 'new message', at: 1001, eventSeq: 1, messageId: 'message-stable-2', clientMessageId: 'client-stable-2' },
    ]);
    reopened.close();

    const schema = new DatabaseSync(path);
    expect(Number(schema.prepare('PRAGMA user_version').get()!.user_version)).toBe(1);
    const columns = schema.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('message_id');
    expect(columns.map((column) => column.name)).toContain('client_message_id');
    schema.close();

    const reopenedAgain = createLogStore(path);
    expect(reopenedAgain.listMessages('game-legacy', 0)).toHaveLength(2);
    reopenedAgain.close();
  });

  it('rejects a future audit schema instead of silently rewriting it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'theater-death-audit-future-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'audit.sqlite');
    const db = new DatabaseSync(path);
    db.exec('PRAGMA user_version = 2;');
    db.close();
    expect(() => createLogStore(path)).toThrowError('unsupported_audit_schema');
  });
});
