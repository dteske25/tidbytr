import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  HomeAssistantOptions,
  PushResult,
  SchedulerDecision,
  SchedulerState,
  SourceHealth,
} from "../core/types.js";
import { defaultSchedulerState } from "../core/scheduler.js";

interface KeyValueRow {
  value: string;
}

interface DecisionRow {
  payload: string;
}

export class TidbytrStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        decided_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  getOptions(fallback: HomeAssistantOptions): HomeAssistantOptions {
    return this.getJson<HomeAssistantOptions>("options") ?? fallback;
  }

  setOptions(options: HomeAssistantOptions): void {
    this.setJson("options", options);
  }

  getSchedulerState(quietHours: SchedulerState["quietHours"]): SchedulerState {
    return this.getJson<SchedulerState>("scheduler_state") ?? defaultSchedulerState(quietHours);
  }

  setSchedulerState(state: SchedulerState): void {
    this.setJson("scheduler_state", state);
  }

  getLastPush(): PushResult | null {
    return this.getJson<PushResult>("last_push");
  }

  setLastPush(result: PushResult): void {
    this.setJson("last_push", result);
  }

  getSourceHealth(): SourceHealth[] {
    return this.getJson<SourceHealth[]>("source_health") ?? [];
  }

  setSourceHealth(health: SourceHealth[]): void {
    this.setJson("source_health", health);
  }

  addDecision(decision: SchedulerDecision): void {
    const statement = this.db.prepare(`
      INSERT OR REPLACE INTO decisions (id, decided_at, payload)
      VALUES (?, ?, ?)
    `);
    statement.run(decision.id, decision.decidedAt, JSON.stringify(decision));

    this.db.exec(`
      DELETE FROM decisions
      WHERE id NOT IN (
        SELECT id FROM decisions ORDER BY decided_at DESC LIMIT 100
      )
    `);
  }

  getDecisions(limit = 25): SchedulerDecision[] {
    const statement = this.db.prepare(`
      SELECT payload
      FROM decisions
      ORDER BY decided_at DESC
      LIMIT ?
    `);

    return statement
      .all(limit)
      .map((row) => JSON.parse((row as unknown as DecisionRow).payload) as SchedulerDecision);
  }

  private getJson<T>(key: string): T | null {
    const statement = this.db.prepare("SELECT value FROM kv WHERE key = ?");
    const row = statement.get(key) as KeyValueRow | undefined;
    if (!row) {
      return null;
    }

    return JSON.parse(row.value) as T;
  }

  private setJson(key: string, value: unknown): void {
    const statement = this.db.prepare(`
      INSERT INTO kv (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    statement.run(key, JSON.stringify(value), new Date().toISOString());
  }
}
