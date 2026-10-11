import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorldState } from '../src/core/types.ts';

export class WorldStore {
  private db: DatabaseSync;
  constructor(directory = process.env.WORLD_DATA_DIR || '.runtime') {
    mkdirSync(resolve(directory), { recursive: true });
    this.db = new DatabaseSync(resolve(directory, 'worlds.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS worlds (session TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS model_cache (key TEXT PRIMARY KEY, response TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_recordings (id TEXT PRIMARY KEY, session TEXT NOT NULL, kind TEXT NOT NULL, input TEXT NOT NULL, output TEXT NOT NULL, model TEXT NOT NULL, usage TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  }
  read(session: string): WorldState | null {
    const row = this.db.prepare('SELECT state FROM worlds WHERE session=?').get(session) as { state: string } | undefined;
    return row ? JSON.parse(row.state) as WorldState : null;
  }
  create(session: string, state: WorldState): WorldState {
    this.db.prepare('INSERT OR IGNORE INTO worlds(session,version,state,updated_at) VALUES(?,?,?,?)').run(session, state.version, JSON.stringify(state), Date.now());
    return this.read(session)!;
  }
  save(session: string, state: WorldState, expectedVersion: number): boolean {
    const result = this.db.prepare('UPDATE worlds SET version=?, state=?, updated_at=? WHERE session=? AND version=?').run(state.version, JSON.stringify(state), Date.now(), session, expectedVersion);
    return Number(result.changes) === 1;
  }
  cached(key: string): unknown | null {
    const row = this.db.prepare('SELECT response FROM model_cache WHERE key=?').get(key) as { response: string } | undefined;
    return row ? JSON.parse(row.response) : null;
  }
  cache(key: string, response: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO model_cache(key,response) VALUES(?,?)').run(key, JSON.stringify(response));
  }
  record(session: string, kind: string, input: unknown, output: unknown, model: string, usage: unknown): string {
    const id = randomUUID();
    this.db.prepare('INSERT INTO model_recordings VALUES(?,?,?,?,?,?,?,?)').run(id, session, kind, JSON.stringify(input), JSON.stringify(output), model, JSON.stringify(usage), Date.now());
    return id;
  }
  recordings(session: string): unknown[] {
    return this.db.prepare('SELECT id,kind,input,output,model,usage,created_at FROM model_recordings WHERE session=? ORDER BY created_at').all(session);
  }
  close(): void { this.db.close(); }
}
