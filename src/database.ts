import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS rooms (
    name TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS members (
    room TEXT NOT NULL REFERENCES rooms(name),
    member TEXT NOT NULL,
    active INTEGER NOT NULL,
    last_read_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (room, member)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL REFERENCES rooms(name),
    sender TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS messages_room_id ON messages(room, id);

  -- owner is '' while the claim is open
  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL REFERENCES rooms(name),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    owner TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    taken_at TEXT NOT NULL,
    UNIQUE (room, name)
  );
`;

/** Opens (and creates if needed) the SQLite file at dbPath. Pass ":memory:" for a throwaway database. */
export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
