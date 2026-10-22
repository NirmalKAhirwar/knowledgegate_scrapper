import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

type GlobalWithDb = typeof globalThis & {
  __kgPracticeDb?: Database.Database;
};

function resolveDbPath(): string {
  const configured = process.env.KG_DB_PATH ?? "../data/kg.db";
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

function addColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate(db: Database.Database): void {
  addColumn(db, "attempt", "grading_source", "TEXT");
  addColumn(db, "session", "mode", "TEXT DEFAULT 'study'");
  addColumn(db, "session", "paused_seconds", "REAL DEFAULT 0");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_attempt_time ON attempt(answered_at);
    CREATE INDEX IF NOT EXISTS idx_attempt_topic ON attempt(topic_id);
    CREATE INDEX IF NOT EXISTS idx_attempt_subject ON attempt(subject_id);
    CREATE INDEX IF NOT EXISTS idx_attempt_kind ON attempt(kind);
  `);
}

function createDb(): Database.Database {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `SQLite database not found at ${dbPath}. Run "uv run kgscrape scrape" first or set KG_DB_PATH.`,
    );
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

const globalForDb = globalThis as GlobalWithDb;

export const db: Database.Database = globalForDb.__kgPracticeDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__kgPracticeDb = db;
}

export function dbPath(): string {
  return resolveDbPath();
}
