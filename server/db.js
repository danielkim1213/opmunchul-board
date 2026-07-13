import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, 'data.sqlite')

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    battletag_key TEXT PRIMARY KEY,     -- lowercased battletag, unique id
    battletag     TEXT NOT NULL,        -- original casing
    password_hash TEXT NOT NULL,
    rank_label    TEXT NOT NULL,
    rank_icon     TEXT,
    avatar        TEXT,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token         TEXT PRIMARY KEY,
    battletag_key TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    FOREIGN KEY (battletag_key) REFERENCES users(battletag_key) ON DELETE CASCADE
  );
`)

export default db
