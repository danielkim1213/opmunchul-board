/**
 * SQLite via Node's built-in `node:sqlite` (Node 22+).
 * No native npm addon — much more reliable on Railway than better-sqlite3.
 */
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATA_DIR || __dirname
mkdirSync(dataDir, { recursive: true })
const DB_PATH = join(dataDir, 'data.sqlite')
console.log('SQLite path:', DB_PATH)

const db = new DatabaseSync(DB_PATH)

// The account model switched from BattleTag-keyed rows to user-chosen
// usernames (BattleTag now comes from Blizzard OAuth). The old `users` table
// keyed by `battletag_key` is incompatible, so drop the legacy schema.
const legacy = db.prepare(`PRAGMA table_info(users)`).all()
if (legacy.length > 0 && !legacy.some((c) => c.name === 'username_key')) {
  console.log('Migrating away from legacy BattleTag-keyed schema (dropping old tables).')
  db.exec('DROP TABLE IF EXISTS sessions;')
  db.exec('DROP TABLE IF EXISTS users;')
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username_key  TEXT PRIMARY KEY,
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    battletag     TEXT NOT NULL,
    battletag_key TEXT NOT NULL UNIQUE,
    blizzard_id   TEXT,
    rank_label    TEXT,
    rank_icon     TEXT,
    rank_role     TEXT,
    most_heroes   TEXT,
    avatar        TEXT,
    created_at    INTEGER NOT NULL,
    rank_fetched_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token         TEXT PRIMARY KEY,
    username_key  TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    FOREIGN KEY (username_key) REFERENCES users(username_key) ON DELETE CASCADE
  );

  -- Short-lived records tracking an in-progress Blizzard OAuth link.
  CREATE TABLE IF NOT EXISTS oauth_links (
    state         TEXT PRIMARY KEY,
    status        TEXT NOT NULL DEFAULT 'pending',
    battletag     TEXT,
    battletag_key TEXT,
    blizzard_id   TEXT,
    profile       TEXT,
    error         TEXT,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    consumed      INTEGER NOT NULL DEFAULT 0
  );
`)

export default db
